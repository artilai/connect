import { z } from "zod";

// The channels the API's requests name, as the artil CLI knows them from Artil Cloud. Email and
// SMS answer that they are only in Artil Cloud.
export const apiChannelKinds = ["email", "sms", "telegram"] as const;

// A channel's kind, which its definition names, or url for the Message URL.
export type ChannelKind = string;

// What the server answers a channel's kind as: any channel it has, beside the ones requests name.
export const channelKindSchema = z.string().describe("The channel's kind, which the channel names");
