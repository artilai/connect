import type { InboundMessage } from "@artil/channels/contract";
import { AppError, messageOf } from "@artil/errors";
import { channel as forumChannel } from "@artil/forum-channel";
import { shellQuoted } from "@artil/utils/shell";
import { minute } from "@artil/utils/time";

import { missingChannel, onlyInCloud } from "../../platform/cloud";
import type { Upload } from "../../platform/storage";
import type { Refusal } from "../access/schema";
import type { AccessService } from "../access/service";
import type { AccountsService } from "../accounts/service";
import type { AddressRecord } from "../addresses/schema";
import type { AddressesService } from "../addresses/service";
import type { ChannelKind } from "../channels/schema";
import { checkLimits, type ChannelsService } from "../channels/service";
import type { EventsService } from "../events/service";
import type { FilesService } from "../files/service";
import { type Topic, wakeLimit, wakeWindow } from "../forum/schema";
import type { ForumService } from "../forum/service";
import type { MessageFilter, MessagesRepository } from "./repository";
import type { Draft, MessageRecord, MessageRow } from "./schema";
import { readSearchWords } from "./search";

const recipientSeparator = ", ";

// The refusals a person mends by putting the sender on the account's list.
const keptOut: ReadonlySet<Refusal> = new Set(["sender", "outsider"]);

type CreateMessagesServiceOptions = {
  messagesRepository: MessagesRepository;
  accounts: AccountsService;
  files: FilesService;
  addresses: AddressesService;
  access: AccessService;
  events: EventsService;
  channels: ChannelsService;
  forum: ForumService;
  log: (line: string) => void;
};

type ListKeptOutOptions = { accountId: string; channel: ChannelKind };

type ReceiveOptions = { channel: ChannelKind; message: InboundMessage };

type Recipients = {
  channel: ChannelKind;
  to: string[];
  // The message this one answers.
  answered?: MessageRow;
};

type SendDraftOptions = {
  accountId: string;
  accountName: string;
  draft: Draft;
  uploads: Upload[];
};

type SendOptions = SendDraftOptions & { recipients: Recipients };

type PostOptions = SendDraftOptions & {
  // The post it answers, whose topic it goes in.
  answered?: MessageRow;
};

// Which of the account's messages to list, or the forum's posts, and the words to search them for.
type ListFilter = MessageFilter & { search?: string };

type ListOptions = { accountId: string; filter: ListFilter };

type FindOptions = { accountId: string; id: string };

type SendReceiptOptions = { receipt: "read" | "answered"; message: MessageRow };

// An answer goes to whoever wrote the message, or to whom the agent wrote it.
function replyRecipients(message: MessageRow): string[] {
  return message.direction === "inbound" ? [message.counterpart] : message.to;
}

// What no channel of this server carries: forwarding, copies and subjects are email's, in Artil
// Cloud. A new topic on the forum takes a subject, as its title.
function checkCarried(draft: Draft, kind: ChannelKind) {
  if (draft.forward) throw onlyInCloud("Forwarding a message");

  if ((draft.cc ?? []).length > 0) {
    throw new AppError({ code: "invalid_input", message: `A message on ${kind} copies no one` });
  }

  if (draft.subject && kind !== forumChannel.kind) {
    throw new AppError({ code: "invalid_input", message: `A message on ${kind} has no subject` });
  }
}

export function createMessagesService({
  messagesRepository,
  accounts,
  files,
  addresses,
  access,
  events,
  channels,
  forum,
  log,
}: CreateMessagesServiceOptions) {
  function toRecords(rows: MessageRow[]): MessageRecord[] {
    const attachmentsByMessage = files.describeByMessages(rows.map(({ id }) => id));

    return rows.map(
      ({
        accountId: _accountId,
        externalId: _externalId,
        externalThread: _externalThread,
        clientThread: _clientThread,
        answeredAt: _answeredAt,
        ...message
      }) => ({
        ...message,
        attachments: attachmentsByMessage.get(message.id) ?? [],
      }),
    );
  }

  function find(options: FindOptions) {
    const row = messagesRepository.find(options);

    return row && toRecords([row])[0];
  }

  // An answer goes where its message came from, a new message where the draft says.
  function resolveRecipients(accountId: string, draft: Draft): Recipients {
    if (!draft.replyTo) {
      if (!draft.channel || !draft.to) {
        throw new AppError({
          code: "invalid_input",
          message: "Give replyTo to answer a message, or a channel and recipients in to",
        });
      }

      return { channel: draft.channel, to: draft.to };
    }

    const repliedMessage = messagesRepository.find({ accountId, id: draft.replyTo });

    if (!repliedMessage) throw new AppError({ code: "not_found", message: "Message not found" });

    return {
      channel: repliedMessage.channel,
      to: draft.to ?? replyRecipients(repliedMessage),
      answered: repliedMessage,
    };
  }

  // The receipts on their way to each message's sender, by the message's id.
  const receiptsInFlight = new Map<string, Promise<void>>();

  // Shows the sender of a message that woke the agent what the agent did with it, where its channel
  // can; a channel that fails only says so in the log.
  async function showReceipt({ receipt, message }: SendReceiptOptions) {
    const channel = channels.find(message.channel);
    const id = message.externalId;

    if (!channel || message.status !== "received" || !id) return;

    try {
      const options = { id, token: addresses.findById(message.addressId)?.token ?? null };

      await (receipt === "read" ? channel.markRead?.(options) : channel.markAnswered?.(options));
    } catch (cause) {
      log(
        `${channel.name} did not show ${message.counterpart} that the agent ${receipt} their message: ${messageOf(cause, String(cause))}`,
      );
    }
  }

  // Nothing waits for a receipt, and each waits for the one before it on the same message, so a slow
  // read cannot land after the answer.
  function sendReceipt(options: SendReceiptOptions) {
    const { id } = options.message;

    const shown = (receiptsInFlight.get(id) ?? Promise.resolve())
      .then(() => showReceipt(options))
      .finally(() => {
        if (receiptsInFlight.get(id) === shown) receiptsInFlight.delete(id);
      });

    receiptsInFlight.set(id, shown);
  }

  // Sends on the channel from the account's address there, and keeps the message among the
  // account's.
  async function send({ accountId, accountName, draft, uploads, recipients }: SendOptions) {
    const { channel: kind, to, answered } = recipients;
    const channel = channels.find(kind);

    if (!channel) throw missingChannel(kind);

    const address = addresses.findByAccount({ accountId, channel: kind });

    if (!address) {
      throw new AppError({
        code: "invalid_input",
        message: `${accountName} has no ${channel.name} address; connect one with: artil-connect account connect ${shellQuoted(accountName)} ${kind}`,
      });
    }

    const attachments = await files.readAttachments({
      accountId,
      attachments: draft.attachments ?? [],
    });

    const outgoingFiles = [...attachments, ...uploads];

    if (outgoingFiles.length > 0 && !files.enabled) throw files.unavailableError();

    checkLimits({ channel, text: draft.text, files: outgoingFiles });

    const message = {
      from: address.value,
      to: addresses.readRecipients({ channel, to }),
      // The channel threads an answer by its own id for the message, when it gave one, and in the
      // provider's thread the message is in.
      replyTo: answered?.externalId ?? undefined,
      thread: answered?.externalThread ?? undefined,
      text: draft.text,
      files: outgoingFiles,
    };

    for (const recipient of message.to) {
      const mustWriteFirst =
        channel.recipientWritesFirst(recipient) &&
        !messagesRepository.hasReceivedFrom({ accountId, channel: kind, counterpart: recipient });

      if (mustWriteFirst) {
        throw new AppError({
          code: "invalid_input",
          message: `${recipient} has to write to ${address.value} before ${accountName} can write to them`,
        });
      }
    }

    const id = crypto.randomUUID();

    messagesRepository.add({
      id,
      accountId,
      addressId: address.id,
      channel: kind,
      direction: "outbound",
      counterpart: message.to.join(recipientSeparator),
      to: message.to,
      text: message.text,
      clientThread: draft.thread,
      status: "sending",
    });

    try {
      await files.save({ accountId, messageId: id, uploads: outgoingFiles });

      const { id: externalId, thread: externalThread } = await channel.send({
        message,
        token: address.token,
        // A channel without a provider, like the Message URL, hands the message back to reach the
        // server's own accounts.
        deliver: (delivered) =>
          deliver({ channel: kind, message: delivered, fromThread: Boolean(draft.thread) }),
      });

      messagesRepository.markSent({ id, externalId, externalThread });
    } catch (cause) {
      const reason = messageOf(cause, "the provider gave no reason");

      messagesRepository.markFailed(id, reason);

      throw cause instanceof AppError
        ? cause
        : new AppError({
            code: "unavailable",
            message: `${channel.name} did not take the message: ${reason}`,
            cause,
          });
    }

    if (answered) {
      messagesRepository.markAnswered(answered.id);
      sendReceipt({ receipt: "answered", message: answered });
    }

    const sent = find({ accountId, id });

    if (!sent) throw new Error(`Message ${id} went missing`);

    return sent;
  }

  type WakeTopicOptions = { topic: Topic; postId: string; poster: AddressRecord };

  // Wakes whoever takes part in the topic besides the poster, whom their lists let the team wake and
  // the topic has not woken too often lately, in the thread of their client that last posted there.
  function wakeTopic({ topic, postId, poster }: WakeTopicOptions) {
    const kind = forumChannel.kind;
    const group = String(topic.id);

    for (const participant of forum.listParticipants(topic)) {
      const { accountId } = participant;

      if (accountId === poster.accountId) continue;

      const { refusal } = access.decide({
        accountId,
        channel: kind,
        from: poster.value,
        username: null,
        group,
        fromSelf: false,
        fromTeam: true,
        fromVerified: true,
      });

      if (refusal) continue;

      if (!forum.countWake(participant)) {
        const name = accounts.findById(accountId)?.name ?? accountId;

        log(
          `Topic ${group} on the forum woke ${name} ${wakeLimit} times in ${wakeWindow / minute} minutes, so its new posts wait for ${name} to look`,
        );

        continue;
      }

      const toThread = messagesRepository.findLastClientThreadByGroup({
        accountId,
        channel: kind,
        counterpart: group,
      });

      events.add({
        accountId,
        event: { type: "message.received", channel: kind, messageId: postId, toThread },
      });
    }
  }

  // Posts what an account writes on the forum, in the topic it names or answers, or a new one. The
  // server keeps one copy of the post, which every account reads, and wakes the topic's others.
  async function post({ accountId, accountName, draft, uploads, answered }: PostOptions) {
    const channel = channels.get(forumChannel.kind);

    const { placement, called } = forum.place({
      recipients: addresses.readRecipients({ channel, to: draft.to ?? [] }),
      answeredTopic: answered && Number(answered.counterpart),
      poster: accountId,
      subject: draft.subject,
      text: draft.text,
    });

    const attachments = await files.readAttachments({
      accountId,
      attachments: draft.attachments ?? [],
    });

    const outgoingFiles = [...attachments, ...uploads];

    if (outgoingFiles.length > 0 && !files.enabled) throw files.unavailableError();

    checkLimits({ channel, text: draft.text, files: outgoingFiles });

    // Every account has its address on the forum, which the server gives it by itself.
    const address = addresses.findByAccount({ accountId, channel: channel.kind });

    if (!address) throw new Error(`${accountName} has no address on the forum`);

    const topic = forum.open(placement);
    const number = String(topic.id);
    const id = crypto.randomUUID();

    await channel.send({
      message: {
        from: address.value,
        to: [number, ...called],
        text: draft.text,
        files: outgoingFiles,
        thread: number,
      },
      token: null,
      // The forum hands the post back, which the server keeps once, in its topic, for everyone.
      deliver: async (delivered) => {
        messagesRepository.add({
          id,
          accountId,
          addressId: address.id,
          channel: channel.kind,
          direction: "inbound",
          externalId: delivered.id,
          externalThread: number,
          counterpart: number,
          counterpartName: topic.title,
          author: accountId,
          authorName: accountName,
          to: delivered.to,
          text: delivered.text,
          clientThread: draft.thread,
          status: "received",
          admission: "team",
        });

        await files.save({ accountId, messageId: id, uploads: delivered.files });
      },
    });

    forum.takePart({ topic, accountIds: [accountId, ...called] });
    wakeTopic({ topic, postId: id, poster: address });

    const posted = find({ accountId, id });

    if (!posted) throw new Error(`Post ${id} went missing`);

    return posted;
  }

  type LogKeptOutOptions = {
    accountId: string;
    channel: ChannelKind;
    message: InboundMessage;
    fromName: string | null;
  };

  // Lets them in by their address, which stays theirs, where a username can pass to someone
  // else; in a group, everyone in it by the group's.
  function logKeptOut({ accountId, channel, message, fromName }: LogKeptOutOptions) {
    const accountName = accounts.findById(accountId)?.name ?? accountId;
    const channelName = channels.find(channel)?.name ?? channel;
    const { from, group } = message;
    const goesBy = from.username ?? from.address;
    const named = fromName ? `${fromName} (${goesBy})` : goesBy;

    // A sender that starts with a dash, like a group's id, reads as no flag only after --.
    function allowCommand(sender: string) {
      const allow = `artil-connect account allow ${shellQuoted(accountName)}`;

      return sender.startsWith("-")
        ? `${allow} --channel ${channel} -- ${shellQuoted(sender)}`
        : `${allow} ${shellQuoted(sender)} --channel ${channel}`;
    }

    log(
      group
        ? `${named} wrote to ${accountName} in ${group.name ?? group.address} on ${channelName} but neither is on its list; let them in with: ${allowCommand(from.address)}, or everyone in the group with: ${allowCommand(group.address)}`
        : `${named} wrote to ${accountName} on ${channelName} but is not on its list; let them in with: ${allowCommand(from.address)}`,
    );
  }

  type FindThreadToWakeOptions = {
    addressId: string;
    counterpart: string;
    replyTo?: string;
    externalThread?: string;
  };

  // The thread of the account's client a message is for: the one that wrote what it answers, or
  // else the last one that wrote in the provider's thread it is in, or else the last one whose
  // message reached whoever sent it, or the group it came in.
  function findThreadToWake({
    addressId,
    counterpart,
    replyTo,
    externalThread,
  }: FindThreadToWakeOptions) {
    const answered = replyTo
      ? messagesRepository.findByExternalId({
          addressId,
          direction: "outbound",
          externalId: replyTo,
        })
      : undefined;

    if (answered?.clientThread) return answered.clientThread;

    const inExternalThread = externalThread
      ? messagesRepository.findLastClientThreadByExternalThread({ addressId, externalThread })
      : null;

    return (
      inExternalThread ??
      messagesRepository.findLastClientThreadByCounterpart({ addressId, counterpart })
    );
  }

  type ReceiveAtOptions = ReceiveOptions & { address: AddressRecord; fromThread: boolean };

  // Takes a message that reached one of the account's addresses, and returns why it did not wake the
  // agent, when it did not.
  async function receiveAt({ channel, message, address, fromThread }: ReceiveAtOptions) {
    if (messagesRepository.hasReceived({ addressId: address.id, externalId: message.id })) {
      return null;
    }

    const accountId = address.accountId;
    const { from, group } = message;
    const sender = addresses.findByValue({ channel, value: from.address });
    const fromSelf = sender?.accountId === accountId;
    // An account's client writes to itself from one thread to another, whatever its list says.
    const betweenThreads = fromSelf && fromThread;
    // The server's own accounts go by their names.
    const fromName = (sender && accounts.findById(sender.accountId)?.name) ?? from.name;

    // A message in a group is the group's, which an answer goes to, and names who wrote it.
    const counterpart = group?.address ?? from.address;

    const { refusal, admission } = access.decide({
      accountId,
      channel,
      from: from.address,
      username: from.username,
      group: group?.address ?? null,
      fromSelf: fromSelf && !betweenThreads,
      // Another account's address on the server is the team's.
      fromTeam: Boolean(sender),
      fromVerified: from.verified,
      listed: betweenThreads,
    });

    // The first time someone the list keeps out writes, or a group, the log says how to let
    // them in.
    if (
      refusal &&
      keptOut.has(refusal) &&
      !messagesRepository.hasReceivedFrom({ accountId, channel, counterpart })
    ) {
      logKeptOut({ accountId, channel, message, fromName });
    }

    const id = crypto.randomUUID();

    // Stored before anything waits, so a message delivered twice at once is taken once.
    messagesRepository.add({
      id,
      accountId,
      addressId: address.id,
      channel,
      direction: "inbound",
      externalId: message.id,
      externalThread: message.thread,
      counterpart,
      counterpartName: group ? group.name : fromName,
      author: group ? from.address : null,
      authorName: group ? fromName : null,
      to: message.to,
      text: message.text,
      status: refusal ? "refused" : "received",
      refusal,
      admission,
    });

    await files.save({ accountId, messageId: id, uploads: message.files });

    if (!refusal) {
      const toThread = findThreadToWake({
        addressId: address.id,
        counterpart,
        replyTo: message.replyTo,
        externalThread: message.thread,
      });

      events.add({
        accountId,
        event: { type: "message.received", channel, messageId: id, toThread },
      });
    }

    return refusal;
  }

  type DeliverOptions = ReceiveOptions & { fromThread: boolean };

  // Takes a message a channel hands back from one of the server's accounts to others, as it takes
  // any message that reaches them, except that the sender hears at once when one does not take it.
  async function deliver({ channel, message, fromThread }: DeliverOptions) {
    const { name, labels } = channels.get(channel);

    for (const value of message.to) {
      const address = addresses.findByValue({ channel, value });

      if (!address) {
        throw new AppError({
          code: "not_found",
          message: `There is no ${name} ${labels.address} ${value} on this server`,
        });
      }

      const refusal = await receiveAt({ channel, message, address, fromThread });

      if (refusal === "self") {
        throw new AppError({
          code: "invalid_input",
          message: `An agent writes to itself on ${name} only from one thread of its client to another`,
        });
      }

      if (refusal) {
        const recipient = accounts.findById(address.accountId)?.name ?? address.accountId;

        throw new AppError({
          code: "forbidden",
          message: `${recipient} does not take ${name} messages from you`,
        });
      }
    }
  }

  return {
    // A message of the account. Reading one that woke the agent shows its sender the agent read it,
    // until the agent answers it.
    read(options: FindOptions) {
      const row = messagesRepository.find(options);

      if (row && !row.answeredAt) sendReceipt({ receipt: "read", message: row });

      return row && toRecords([row])[0];
    },

    // Who wrote to the account on the channel and was kept out for being on neither its team nor
    // its list, the latest first.
    listKeptOut: ({ accountId, channel }: ListKeptOutOptions) =>
      messagesRepository.listRefusedSenders({ accountId, channel, refusals: [...keptOut] }),

    // The account's messages, or the forum's posts, newest first, or those that hold the words
    // searched for, best match first.
    list({ accountId, filter: { search, ...filter } }: ListOptions) {
      if (!search) return toRecords(messagesRepository.list({ accountId, filter }));

      const { before, ...narrowing } = filter;

      if (before) {
        throw new AppError({
          code: "invalid_input",
          message: "A search lists its best matches, so it pages back from no message",
        });
      }

      return toRecords(
        messagesRepository.search({
          accountId,
          filter: { ...narrowing, words: readSearchWords(search) },
        }),
      );
    },

    // Takes a message a channel brought to the addresses it went to: it wakes the agent of each
    // account one of them belongs to when its senders may, and stays in the account's messages
    // either way.
    receive: async ({ channel, message }: ReceiveOptions) => {
      for (const value of message.to) {
        const address = addresses.findByValue({ channel, value });

        if (address) await receiveAt({ channel, message, address, fromThread: false });
      }
    },

    // Sends what an agent writes, and returns the copy the account keeps, which on the forum is the
    // post everyone reads. An answer goes back the way its message came.
    sendDraft({ accountId, accountName, draft, uploads }: SendDraftOptions) {
      const recipients = resolveRecipients(accountId, draft);

      checkCarried(draft, recipients.channel);

      if (recipients.channel === forumChannel.kind) {
        return post({ accountId, accountName, draft, uploads, answered: recipients.answered });
      }

      return send({ accountId, accountName, draft, uploads, recipients });
    },
  };
}

export type MessagesService = ReturnType<typeof createMessagesService>;

export type Receive = MessagesService["receive"];
