// The Slack app an account connects, as Slack's app manifest describes it: a bot named after the
// account, on Socket Mode, that hears direct messages and mentions and answers them, with files.
function manifestOf(account: string) {
  // Slack names a bot in lowercase letters, digits, dots, dashes and underscores.
  const bot =
    account
      .toLowerCase()
      .replaceAll(/\s+/gv, "-")
      .replaceAll(/[^a-z0-9._\-]/gv, "")
      .slice(0, 80) || "agent";

  return {
    display_information: { name: account.slice(0, 35) },
    features: {
      app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: bot, always_online: true },
    },
    oauth_config: {
      scopes: {
        bot: [
          "app_mentions:read",
          "channels:history",
          "channels:read",
          "chat:write",
          "files:read",
          "files:write",
          "groups:history",
          "groups:read",
          "im:history",
          "im:write",
          "mpim:history",
          "users:read",
        ],
      },
    },
    settings: {
      event_subscriptions: { bot_events: ["app_mention", "message.im"] },
      socket_mode_enabled: true,
    },
  };
}

// A link that opens Slack's app creation with the account's app described already.
export function newAppLink(account: string) {
  const manifest = encodeURIComponent(JSON.stringify(manifestOf(account)));

  return `https://api.slack.com/apps?new_app=1&manifest_json=${manifest}`;
}
