import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { z } from "zod";

import { createBotApi } from "./bot-api";

const webhookSecret = "webhook-secret";

const token = "123456:ABC-def_ghi";

type Answer = { status?: number; body: unknown };

// The bot's own token, which Artil keeps with its address.
async function tokenOf(bot: string) {
  return bot === "AcmeSupportBot" ? token : null;
}

const photoBytes = new Uint8Array([0xff, 0xd8, 0xff]);

// Form data shows each file by its name, type and text.
async function readBody(body: RequestInit["body"]) {
  if (!(body instanceof FormData)) return new Response(body).json();

  const fields: Promise<[string, unknown]>[] = [];

  body.forEach((value, key) => {
    fields.push(
      value instanceof File
        ? value.text().then((text) => [key, { name: value.name, type: value.type, text }])
        : Promise.resolve([key, value]),
    );
  });

  return Object.fromEntries(await Promise.all(fields));
}

type SetupOptions = { answers?: Record<string, Answer>; webhook?: boolean };

function setup({ answers = {}, webhook = true }: SetupOptions = {}) {
  const requests: { method: string; body: unknown }[] = [];
  const tokens: string[] = [];

  const botApi = createBotApi({
    ...(webhook && {
      webhook: { url: "https://artil.test/api/channels/telegram", secret: webhookSecret },
    }),
    sleep: async () => {},
    fetch: async (url, init) => {
      const [, owner = "", path = ""] = /\/file\/bot([^\/]+)\/(.+)$/v.exec(url) ?? [];

      if (path) {
        tokens.push(owner);
        requests.push({ method: "download", body: path });

        return new Response(photoBytes);
      }

      const [, bot = "", method = ""] = /\/bot([^\/]+)\/(\w+)$/v.exec(url) ?? [];
      tokens.push(bot);
      requests.push({ method, body: await readBody(init.body) });
      const answer = answers[method] ?? { body: { ok: true, result: true } };

      if (Array.isArray(answer.body)) {
        const [next, ...rest] = answer.body;
        answers[method] = { ...answer, body: rest.length > 0 ? rest : next };

        return Response.json(next, { status: answer.status ?? 200 });
      }

      return Response.json(answer.body, { status: answer.status ?? 200 });
    },
  });

  // Reads updates the way the channel does, with the tokens of the bots Artil holds.
  const telegram = {
    ...botApi,
    verifyEvents: (request: Request) => botApi.verifyEvents(request, tokenOf),
  };

  return { telegram, botApi, requests, tokens };
}

function secretFor(bot: string) {
  return createHmac("sha256", webhookSecret).update(bot).digest("base64url");
}

type File = { file_id: string; mime_type?: string; file_size?: number };

type Message = {
  message_id: number;
  from: { id: number; is_bot: boolean; first_name: string; username?: string };
  chat: { id: number; type: string; title?: string };
  date: number;
  text?: string;
  entities?: { type: string; offset: number; length: number }[];
  caption_entities?: { type: string; offset: number; length: number }[];
  media_group_id?: string;
  document?: File & { file_name?: string };
  caption?: string;
  voice?: File & { duration: number };
  video?: File;
  photo?: (File & { width: number; height: number })[];
  reply_to_message?: Omit<Message, "reply_to_message" | "quote">;
  quote?: { text: string; position: number; is_manual?: true };
  managed_bot_created?: { bot: { id: number; is_bot: true; first_name: string; username: string } };
};

function update(message: Message, secret = secretFor("AcmeSupportBot")) {
  return new Request("https://artil.test/api/channels/telegram?bot=AcmeSupportBot", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify({ update_id: 1, message }),
  });
}

async function noToken() {
  return null;
}

const fromAda: Message = {
  message_id: 7,
  from: { id: 42, is_bot: false, first_name: "Ada", username: "AdaLovelace" },
  chat: { id: 42, type: "private" },
  date: 1_760_000_000,
};

const botAnswer = {
  body: { ok: true, result: { id: 123456, is_bot: true, username: "AcmeSupportBot" } },
};

test("checks a bot's token and finds its username", async () => {
  const { telegram, requests } = setup({ answers: { getMe: botAnswer } });

  expect(await telegram.connect(token)).toBe("AcmeSupportBot");
  expect(requests).toEqual([{ method: "getMe", body: {} }]);
});

type StartOptions = { telegram: ReturnType<typeof setup>["telegram"] };

// Starts the bot the way the server does once it connects, and notes what failed on the way.
async function start({ telegram }: StartOptions) {
  const errors: unknown[] = [];

  await telegram.start({
    token,
    signal: new AbortController().signal,
    onEvents: async () => {},
    onError: (cause) => errors.push(cause),
  });

  return errors;
}

test("points the bot's messages at Artil under a secret of its own", async () => {
  const { telegram, requests } = setup({ answers: { getMe: botAnswer } });

  expect(await start({ telegram })).toEqual([]);
  expect(requests).toEqual([
    { method: "getMe", body: {} },
    {
      method: "setWebhook",
      body: {
        url: "https://artil.test/api/channels/telegram?bot=AcmeSupportBot",
        secret_token: secretFor("AcmeSupportBot"),
        allowed_updates: ["message"],
      },
    },
  ]);
});

test("points the bot at the webhook again until Telegram takes it", async () => {
  const badGateway = { ok: false, description: "Bad Gateway" };

  const { telegram, requests } = setup({
    answers: {
      getMe: botAnswer,
      setWebhook: { body: [badGateway, badGateway, { ok: true, result: true }] },
    },
  });

  const errors = await start({ telegram });

  expect(errors.map(String)).toEqual(["Error: Bad Gateway", "Error: Bad Gateway"]);
  expect(requests.filter(({ method }) => method === "setWebhook")).toHaveLength(3);
});

test("refuses a token Telegram does not know", async () => {
  const { telegram, requests } = setup({
    answers: {
      getMe: { status: 401, body: { ok: false, error_code: 401, description: "Unauthorized" } },
    },
  });

  await expect(telegram.connect(token)).rejects.toMatchObject({
    code: "invalid_input",
    message: "Telegram does not know that bot token",
  });
  await expect(telegram.connect("not a token")).rejects.toMatchObject({ code: "invalid_input" });
  expect(requests).toHaveLength(1);
});

test("stops the bot's messages reaching Artil", async () => {
  const { telegram, requests } = setup();

  await telegram.disconnect(token);

  expect(requests).toEqual([{ method: "deleteWebhook", body: {} }]);
});

test("reads a private message from a webhook with the bot's secret", async () => {
  const { telegram } = setup();

  expect(await telegram.verifyEvents(update({ ...fromAda, text: "Hi" }))).toEqual([
    {
      type: "received",
      message: {
        id: "42:7",
        bot: "AcmeSupportBot",
        chat: "42",
        group: null,
        senderId: "42",
        fromBot: null,
        username: "AdaLovelace",
        fromName: "Ada",
        text: "Hi",
        files: [],
        quote: null,
      },
    },
  ]);
});

test("refuses a webhook without the bot's secret", async () => {
  const { telegram } = setup();

  await expect(
    telegram.verifyEvents(update({ ...fromAda, text: "Hi" }, secretFor("OtherBot"))),
  ).rejects.toMatchObject({ code: "unauthorized" });
});

test("reads what tags the bot in a group or answers it, and skips the rest of the group", async () => {
  const { telegram } = setup();
  const inGroup = { ...fromAda, chat: { id: -100_42, type: "supergroup", title: "Launch" } };

  function tagged(text: string, type: string) {
    const tag = text.split(" ")[0] ?? "";

    return update({ ...inGroup, text, entities: [{ type, offset: 0, length: tag.length }] });
  }

  expect(await telegram.verifyEvents(tagged("@acmesupportbot are you there?", "mention"))).toEqual([
    {
      type: "received",
      message: {
        id: "-10042:7",
        bot: "AcmeSupportBot",
        chat: "-10042",
        group: { title: "Launch" },
        senderId: "42",
        fromBot: null,
        username: "AdaLovelace",
        fromName: "Ada",
        text: "@acmesupportbot are you there?",
        files: [],
        quote: null,
      },
    },
  ]);
  expect(await telegram.verifyEvents(tagged("/status@AcmeSupportBot", "bot_command"))).toHaveLength(
    1,
  );

  const answer = update({
    ...inGroup,
    text: "Thanks",
    reply_to_message: {
      ...inGroup,
      from: { id: 123456, is_bot: true, first_name: "Support", username: "AcmeSupportBot" },
      text: "Done",
    },
  });

  expect(await telegram.verifyEvents(answer)).toHaveLength(1);
  expect(await telegram.verifyEvents(update({ ...inGroup, text: "Hi all" }))).toEqual([]);
  expect(await telegram.verifyEvents(tagged("@otherbot hi", "mention"))).toEqual([]);
  expect(await telegram.verifyEvents(tagged("/status@OtherBot", "bot_command"))).toEqual([]);
});

test("takes every file of an album that tagged the bot in a group, and none of one that did not", async () => {
  const { telegram } = setup({
    answers: { getFile: { body: { ok: true, result: { file_path: "documents/file.log" } } } },
  });

  const inGroup = { ...fromAda, chat: { id: -100_42, type: "supergroup", title: "Launch" } };
  const caption = "@acmesupportbot the logs";

  function file(id: number, album: string) {
    return {
      ...inGroup,
      message_id: id,
      media_group_id: album,
      document: { file_id: `file-${id}`, file_name: `${id}.log`, file_size: 3 },
    };
  }

  const tagged = {
    ...file(8, "album-1"),
    caption,
    caption_entities: [{ type: "mention", offset: 0, length: 15 }],
  };

  expect(await telegram.verifyEvents(update(tagged))).toHaveLength(1);
  expect(await telegram.verifyEvents(update(file(9, "album-1")))).toMatchObject([
    { message: { id: "-10042:9", files: [{ name: "9.log" }] } },
  ]);
  expect(await telegram.verifyEvents(update(file(10, "album-2")))).toEqual([]);
});

test("skips updates without a message", async () => {
  const { telegram } = setup();

  expect(
    await telegram.verifyEvents(
      new Request("https://artil.test/api/channels/telegram?bot=AcmeSupportBot", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": secretFor("AcmeSupportBot") },
        body: JSON.stringify({ update_id: 2, edited_message: fromAda }),
      }),
    ),
  ).toEqual([]);
});

test("describes the files of a bot Artil holds no token for, with their caption as the text", async () => {
  const { botApi } = setup();

  const [voice, photo] = [
    { ...fromAda, voice: { file_id: "v", duration: 3, mime_type: "audio/ogg", file_size: 900 } },
    {
      ...fromAda,
      caption: "The error",
      photo: [
        { file_id: "small", width: 90, height: 60, file_size: 1_000 },
        { file_id: "large", width: 1280, height: 853, file_size: 90_000 },
      ],
    },
  ];

  expect(await botApi.verifyEvents(update(voice), noToken)).toMatchObject([
    {
      message: {
        text: "",
        files: [{ name: "voice.ogg", type: "audio/ogg", size: 900, content: null }],
      },
    },
  ]);
  expect(await botApi.verifyEvents(update(photo), noToken)).toMatchObject([
    {
      message: {
        text: "The error",
        files: [{ name: "photo.jpg", type: "image/jpeg", size: 90_000, content: null }],
      },
    },
  ]);
});

test("downloads a file with the bot's token", async () => {
  const { telegram, requests, tokens } = setup({
    answers: {
      getFile: { body: { ok: true, result: { file_id: "large", file_path: "photos/file_1.jpg" } } },
    },
  });

  const photo = {
    ...fromAda,
    photo: [
      { file_id: "small", width: 90, height: 60, file_size: 1_000 },
      { file_id: "large", width: 1280, height: 853, file_size: 90_000 },
    ],
  };

  expect(await telegram.verifyEvents(update(photo))).toMatchObject([
    {
      message: {
        files: [{ name: "photo.jpg", type: "image/jpeg", size: 3, content: photoBytes }],
      },
    },
  ]);
  expect(requests).toEqual([
    { method: "getFile", body: { file_id: "large" } },
    { method: "download", body: "photos/file_1.jpg" },
  ]);
  expect(tokens).toEqual([token, token]);
});

test("describes a file Telegram does not hand a bot", async () => {
  const { telegram } = setup({
    answers: {
      getFile: {
        status: 400,
        body: { ok: false, error_code: 400, description: "Bad Request: file is too big" },
      },
    },
  });

  const video = {
    ...fromAda,
    video: { file_id: "v", mime_type: "video/mp4", file_size: 90_000_000 },
  };

  expect(await telegram.verifyEvents(update(video))).toMatchObject([
    {
      message: {
        files: [{ name: "video.mp4", type: "video/mp4", size: 90_000_000, content: null }],
      },
    },
  ]);
});

test("fails an update whose file Telegram could not hand over yet, so Telegram sends it again", async () => {
  const { telegram } = setup({
    answers: {
      getFile: { status: 502, body: { ok: false, description: "Bad Gateway" } },
    },
  });

  const voice = { ...fromAda, voice: { file_id: "v", duration: 3, file_size: 900 } };

  await expect(telegram.verifyEvents(update(voice))).rejects.toThrow("Bad Gateway");
});

test("keeps the message a reply answers, or only the part the sender quoted", async () => {
  const { telegram } = setup();

  const fromEve = {
    ...fromAda,
    message_id: 6,
    from: { id: 123456, is_bot: true, first_name: "Eve", username: "AcmeSupportBot" },
    text: "Your username is @AdaLovelace.\nYour ID is 42.",
  };

  const reply = { ...fromAda, text: "Right?", reply_to_message: fromEve };

  expect(await telegram.verifyEvents(update(reply))).toMatchObject([
    { message: { text: "Right?", quote: { fromName: "Eve", text: fromEve.text } } },
  ]);
  expect(
    await telegram.verifyEvents(
      update({ ...reply, quote: { text: "Your ID is 42.", position: 31 } }),
    ),
  ).toMatchObject([{ message: { quote: { fromName: "Eve", text: "Your ID is 42." } } }]);
});

test("names a bot that writes by its username, and only a person by the one they chose", async () => {
  const { telegram } = setup();

  const fromBot = {
    ...fromAda,
    from: { id: 99, is_bot: true, first_name: "Ops", username: "OpsBot" },
  };

  expect(await telegram.verifyEvents(update({ ...fromBot, text: "Done" }))).toMatchObject([
    { message: { fromBot: "OpsBot", username: null } },
  ]);
});

test("sends a message to a chat and keeps its id", async () => {
  const { telegram, requests } = setup({
    answers: {
      sendMessage: { body: { ok: true, result: { message_id: 8, chat: { id: 42 }, date: 0 } } },
    },
  });

  const hello = { token, text: "Hello", files: [], replyTo: null };

  expect(await telegram.send({ ...hello, chat: "42" })).toEqual({ id: "42:8" });
  expect(await telegram.send({ ...hello, chat: "@opsbot" })).toEqual({ id: "42:8" });
  expect(await telegram.send({ ...hello, chat: "42", replyTo: "42:7" })).toEqual({
    id: "42:8",
  });
  await telegram.send({ ...hello, chat: "-10042" });
  expect(requests).toEqual([
    { method: "sendMessage", body: { chat_id: 42, text: "Hello" } },
    { method: "sendMessage", body: { chat_id: "@opsbot", text: "Hello" } },
    {
      method: "sendMessage",
      body: {
        chat_id: 42,
        text: "Hello",
        reply_parameters: { message_id: 7, allow_sending_without_reply: true },
      },
    },
    { method: "sendMessage", body: { chat_id: -10042, text: "Hello" } },
  ]);
});

function fileOf(name: string, text: string) {
  return {
    name,
    type: "application/pdf",
    size: text.length,
    content: new TextEncoder().encode(text),
  };
}

const sentAnswer = { body: { ok: true, result: { message_id: 9, chat: { id: 42 }, date: 0 } } };

test("sends a file as a document, with the text as its caption", async () => {
  const { telegram, requests } = setup({ answers: { sendDocument: sentAnswer } });

  expect(
    await telegram.send({
      token,
      chat: "42",
      text: "The notes",
      files: [fileOf("a.pdf", "A")],
      replyTo: null,
    }),
  ).toEqual({ id: "42:9" });
  expect(requests).toEqual([
    {
      method: "sendDocument",
      body: {
        chat_id: "42",
        document: { name: "a.pdf", type: "application/pdf", text: "A" },
        caption: "The notes",
      },
    },
  ]);
});

test("sends several files as an album, with the caption under the last", async () => {
  const { telegram, requests } = setup({
    answers: {
      sendMediaGroup: {
        body: {
          ok: true,
          result: [
            { message_id: 9, chat: { id: 42 }, date: 0 },
            { message_id: 10, chat: { id: 42 }, date: 0 },
          ],
        },
      },
    },
  });

  const files = [fileOf("a.pdf", "A"), fileOf("b.pdf", "B")];

  expect(
    await telegram.send({ token, chat: "42", text: "The notes", files, replyTo: null }),
  ).toEqual({
    id: "42:9",
  });
  expect(requests).toEqual([
    {
      method: "sendMediaGroup",
      body: {
        chat_id: "42",
        file0: { name: "a.pdf", type: "application/pdf", text: "A" },
        file1: { name: "b.pdf", type: "application/pdf", text: "B" },
        media: JSON.stringify([
          { type: "document", media: "attach://file0" },
          { type: "document", media: "attach://file1", caption: "The notes" },
        ]),
      },
    },
  ]);
});

test("sends a text too long for a caption before its files", async () => {
  const { telegram, requests } = setup({
    answers: { sendMessage: sentAnswer, sendDocument: sentAnswer },
  });

  const text = "a".repeat(1025);

  await telegram.send({ token, chat: "42", text, files: [fileOf("a.pdf", "A")], replyTo: null });

  expect(requests).toEqual([
    { method: "sendMessage", body: { chat_id: 42, text } },
    {
      method: "sendDocument",
      body: { chat_id: "42", document: { name: "a.pdf", type: "application/pdf", text: "A" } },
    },
  ]);
});

test("fails a send with Telegram's reason", async () => {
  const { telegram } = setup({
    answers: {
      sendMessage: {
        status: 403,
        body: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
      },
    },
  });

  await expect(
    telegram.send({ token, chat: "42", text: "Hello", files: [], replyTo: null }),
  ).rejects.toThrow("Forbidden: bot was blocked by the user");
});

test("says how to let bots write to each other when Telegram refuses one", async () => {
  const { telegram } = setup({
    answers: {
      sendMessage: {
        status: 400,
        body: { ok: false, error_code: 400, description: "Bad Request: USER_BOT_TO_BOT_DISABLED" },
      },
    },
  });

  await expect(
    telegram.send({ token, chat: "@opsbot", text: "Hello", files: [], replyTo: null }),
  ).rejects.toThrow(
    "Telegram passes messages between bots only when both turn on Bot-to-Bot Communication Mode in @BotFather",
  );
});

test("keeps the token out of a failure to reach Telegram", async () => {
  const telegram = createBotApi({
    fetch: async (url) => {
      throw new Error(`Unable to connect to ${url}`);
    },
  });

  const failure = await telegram
    .send({ token, chat: "42", text: "Hello", files: [], replyTo: null })
    .catch((cause: unknown) => cause);

  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).not.toContain(token);
});

const offsetSchema = z.object({ offset: z.number() });

type ReceiveOptions = {
  answers: Record<string, Answer>;
  // Stops once Telegram answered this many requests for updates.
  polls: number;
  // Fails taking the batch this many times before taking it.
  refusals?: number;
};

// Asks Telegram for updates, as many times as the test says.
async function receive({ answers, polls, refusals = 0 }: ReceiveOptions) {
  const { telegram, requests } = setup({
    answers: { getMe: botAnswer, ...answers },
    webhook: false,
  });

  const controller = new AbortController();
  const taken: unknown[] = [];
  const errors: unknown[] = [];
  let refused = 0;

  await telegram.start({
    token,
    signal: controller.signal,
    onEvents: async (events) => {
      if (requests.filter(({ method }) => method === "getUpdates").length >= polls) {
        controller.abort();
      }

      if (events.length === 0) return;

      if (refused < refusals) {
        refused += 1;
        throw new Error("Could not store the batch");
      }

      taken.push(...events);
    },
    onError: (cause) => errors.push(cause),
  });

  const offsets = requests
    .filter(({ method }) => method === "getUpdates")
    .map(({ body }) => offsetSchema.parse(body).offset);

  return { taken, errors, offsets, requests };
}

function updates(...batches: { update_id: number; message?: Message }[][]) {
  return { body: [...batches.map((result) => ({ ok: true, result })), { ok: true, result: [] }] };
}

test("asks Telegram for private messages to the bot and confirms each batch it took", async () => {
  const { taken, offsets, requests } = await receive({
    polls: 3,
    answers: {
      getUpdates: updates(
        [
          { update_id: 10, message: { ...fromAda, text: "Hi" } },
          { update_id: 11, message: { ...fromAda, chat: { id: -1, type: "group" }, text: "All" } },
        ],
        [{ update_id: 12 }],
      ),
    },
  });

  expect(taken).toEqual([
    { type: "received", message: expect.objectContaining({ id: "42:7", text: "Hi" }) },
  ]);
  expect(offsets).toEqual([0, 12, 13]);
  expect(requests.slice(0, 3)).toEqual([
    { method: "getMe", body: {} },
    { method: "deleteWebhook", body: {} },
    {
      method: "getUpdates",
      body: { offset: 0, timeout: 50, allowed_updates: ["message"] },
    },
  ]);
});

test("asks for a batch again until it is taken, and goes on after Telegram fails", async () => {
  const { taken, errors, offsets } = await receive({
    polls: 4,
    refusals: 1,
    answers: {
      getUpdates: {
        body: [
          { ok: false, description: "Bad Gateway" },
          { ok: true, result: [{ update_id: 5, message: { ...fromAda, text: "Hi" } }] },
          { ok: true, result: [{ update_id: 5, message: { ...fromAda, text: "Hi" } }] },
          { ok: true, result: [] },
        ],
      },
    },
  });

  expect(taken).toHaveLength(1);
  expect(errors.map(String)).toEqual(["Error: Bad Gateway", "Error: Could not store the batch"]);
  expect(offsets).toEqual([0, 0, 0, 6]);
});
