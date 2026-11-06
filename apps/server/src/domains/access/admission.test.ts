import { expect, test } from "bun:test";

import { admissionOf, admit, defaultLimits } from "./admission";
import { describeRefusal } from "./schema";

const ordinary = {
  fromSelf: false,
  spam: false,
  access: { admit: "anyone" as const, senders: [] },
  from: "ada@example.com",
  handle: null,
  fromTeam: false,
  fromVerified: true,
  wakesInLastHour: 0,
};

const list = { admit: "list" as const, senders: ["ada@example.com"] };

const team = { admit: "team" as const, senders: [] };

test("wakes the agent for an ordinary message", () => {
  expect(admit(ordinary, defaultLimits)).toBeNull();
});

test("does not wake the agent for its own messages, spam, strangers, unverified senders, or past its limits", () => {
  expect(admit({ ...ordinary, fromSelf: true }, defaultLimits)).toBe("self");
  expect(admit({ ...ordinary, spam: true }, defaultLimits)).toBe("spam");
  expect(admit({ ...ordinary, access: list, from: "eve@example.com" }, defaultLimits)).toBe(
    "sender",
  );
  expect(admit({ ...ordinary, access: list, fromVerified: false }, defaultLimits)).toBe(
    "unverified",
  );
  expect(admit({ ...ordinary, access: team }, defaultLimits)).toBe("outsider");
  expect(
    admit({ ...ordinary, access: team, fromTeam: true, fromVerified: false }, defaultLimits),
  ).toBe("unverified");
  expect(admit({ ...ordinary, wakesInLastHour: 2 }, { ...defaultLimits, wakesPerHour: 2 })).toBe(
    "rate_limit",
  );
  expect(
    admit({ ...ordinary, wakesInLastHour: 1 }, { ...defaultLimits, wakesPerHour: 2 }),
  ).toBeNull();
});

test("names the loop before spam, spam before the sender, and the sender before the hour", () => {
  const everything = {
    fromSelf: true,
    spam: true,
    access: list,
    from: "eve@example.com",
    handle: null,
    fromTeam: false,
    fromVerified: false,
    wakesInLastHour: 999,
  };

  expect(admit(everything, defaultLimits)).toBe("self");
  expect(admit({ ...everything, fromSelf: false }, defaultLimits)).toBe("spam");

  const notSpam = { ...everything, fromSelf: false, spam: false };

  expect(admit(notSpam, defaultLimits)).toBe("sender");
  expect(admit({ ...notSpam, from: "ada@example.com" }, defaultLimits)).toBe("unverified");
});

test("lets anyone through an open channel, the verified team through a team one and verified listed senders through a list", () => {
  expect(
    admit({ ...ordinary, from: "eve@example.com", fromVerified: false }, defaultLimits),
  ).toBeNull();
  expect(admit({ ...ordinary, access: team, fromTeam: true }, defaultLimits)).toBeNull();
  expect(admit({ ...ordinary, access: list }, defaultLimits)).toBeNull();
});

test("lets the senders listed beside the team through, and keeps the rest out", () => {
  const teamAndAda = { admit: "team" as const, senders: ["ada@example.com"] };

  expect(admit({ ...ordinary, access: teamAndAda }, defaultLimits)).toBeNull();
  expect(admit({ ...ordinary, access: teamAndAda, fromVerified: false }, defaultLimits)).toBe(
    "unverified",
  );
  expect(admit({ ...ordinary, access: teamAndAda, from: "eve@example.com" }, defaultLimits)).toBe(
    "outsider",
  );
});

test("names the team before the list, and anyone else or anyone unverified as anyone", () => {
  expect(admissionOf({ ...ordinary, access: list, fromTeam: true })).toBe("team");
  expect(admissionOf({ ...ordinary, access: list })).toBe("listed");
  expect(admissionOf(ordinary)).toBe("anyone");
  expect(admissionOf({ ...ordinary, access: list, fromTeam: true, fromVerified: false })).toBe(
    "anyone",
  );
});

test("lets a Telegram user through by the @username they go by", () => {
  const ada = { ...ordinary, from: "42", handle: "@ada_lovelace" };
  const listed = { admit: "list" as const, senders: ["@ada_lovelace"] };

  expect(admit({ ...ada, access: listed }, defaultLimits)).toBeNull();
  expect(admissionOf({ ...ada, access: listed })).toBe("listed");
  expect(admit({ ...ada, handle: null, access: listed }, defaultLimits)).toBe("sender");
});

test("describes each refusal, and names one from a newer server by its code", () => {
  expect(describeRefusal("spam")).toBe("Did not wake the agents: it was marked as spam.");
  expect(describeRefusal("quiet_hours")).toBe("Did not wake the agents: quiet_hours.");
});
