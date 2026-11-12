import { SlackChannel } from "./channel";
import { createWebApi } from "./web-api";

// The Slack channel the server loads, talking to Slack's Web API and Socket Mode.
export const channel = new SlackChannel(createWebApi());
