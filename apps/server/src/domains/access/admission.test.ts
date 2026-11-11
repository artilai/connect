import { expect, test } from "bun:test";

import { admissionOf, admit } from "./admission";
import { describeRefusal } from "./schema";

const ordinary = {
  fromSelf: false,
  spam: false,
  access: { admit: "anyone" as const, senders: [] },
  from: "ada@example.com",
  handle: null,
  group: null,
  fromTeam: false,
  fromVerified: true,
};

const list = { admit: "list" as const, senders: ["ada@example.com"] };

const team = { admit: "team" as const, senders: [] };

test("wakes the agent for an ordinary message", () => {
  expect(admit(ordinary)).toBeNull();
});

test("does not wake the agent for its own messages, spam, strangers or unverified senders", () => {
  expect(admit({ ...ordinary, fromSelf: true })).toBe("self");
  expect(admit({ ...ordinary, spam: true })).toBe("spam");
  expect(admit({ ...ordinary, access: list, from: "eve@example.com" })).toBe("sender");
  expect(admit({ ...ordinary, access: list, fromVerified: false })).toBe("unverified");
  expect(admit({ ...ordinary, access: team })).toBe("outsider");
  expect(admit({ ...ordinary, access: team, fromTeam: true, fromVerified: false })).toBe(
    "unverified",
  );
});

test("names the loop before spam, spam before the sender, and the sender before verification", () => {
  const everything = {
    fromSelf: true,
    spam: true,
    access: list,
    from: "eve@example.com",
    handle: null,
    group: null,
    fromTeam: false,
    fromVerified: false,
  };

  expect(admit(everything)).toBe("self");
  expect(admit({ ...everything, fromSelf: false })).toBe("spam");

  const notSpam = { ...everything, fromSelf: false, spam: false };

  expect(admit(notSpam)).toBe("sender");
  expect(admit({ ...notSpam, from: "ada@example.com" })).toBe("unverified");
});

test("lets anyone through an open channel, the verified team through a team one and verified listed senders through a list", () => {
  expect(admit({ ...ordinary, from: "eve@example.com", fromVerified: false })).toBeNull();
  expect(admit({ ...ordinary, access: team, fromTeam: true })).toBeNull();
  expect(admit({ ...ordinary, access: list })).toBeNull();
});

test("lets the senders listed beside the team through, and keeps the rest out", () => {
  const teamAndAda = { admit: "team" as const, senders: ["ada@example.com"] };

  expect(admit({ ...ordinary, access: teamAndAda })).toBeNull();
  expect(admit({ ...ordinary, access: teamAndAda, fromVerified: false })).toBe("unverified");
  expect(admit({ ...ordinary, access: teamAndAda, from: "eve@example.com" })).toBe("outsider");
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

  expect(admit({ ...ada, access: listed })).toBeNull();
  expect(admissionOf({ ...ada, access: listed })).toBe("listed");
  expect(admit({ ...ada, handle: null, access: listed })).toBe("sender");
});

test("lets everyone in a group through once the group is on the list", () => {
  const inGroup = { ...ordinary, from: "42", group: "-10042" };
  const listed = { admit: "list" as const, senders: ["-10042"] };

  expect(admit({ ...inGroup, access: listed })).toBeNull();
  expect(admissionOf({ ...inGroup, access: listed })).toBe("listed");
  expect(admit({ ...inGroup, group: null, access: listed })).toBe("sender");
});

test("describes each refusal, and names one from a newer server by its code", () => {
  expect(describeRefusal("spam")).toBe("Did not wake the agents: it was marked as spam.");
  expect(describeRefusal("quiet_hours")).toBe("Did not wake the agents: quiet_hours.");
});
