import { createBotApi } from "./bot-api";
import { TelegramChannel } from "./channel";

// The Telegram channel the server loads, talking to Telegram's Bot API.
export const channel = new TelegramChannel(createBotApi());
