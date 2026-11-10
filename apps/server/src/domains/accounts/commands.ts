import { AppError } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { loginCommand } from "../../platform/artil-cli";
import { type Command, type Confirm, defineCommand, toRows } from "../../platform/commands";
import { type Access, defaultAccess } from "../access/schema";
import type { AccessService } from "../access/service";
import type { AddressesService } from "../addresses/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { ConnectionsService } from "../connections/service";
import type { TokensService } from "../tokens/service";
import { toMessageUrl, urlKind } from "../url/schema";
import type { AccountsService } from "./service";

type AccountCommandsOptions = {
  accounts: AccountsService;
  tokens: TokensService;
  addresses: AddressesService;
  access: AccessService;
  connections: ConnectionsService;
  channels: ChannelsService;
  confirm: Confirm;
  out: (line: string) => void;
  // Where agents reach the server, to tell them how to sign in.
  baseUrl: () => Promise<string>;
};

type SignInGuideOptions = { baseUrl: string; names: readonly string[] };

// The account by its id or present name, and the name it takes.
type RenameAccountOptions = { name: string; newName: string };

type IssueTokenOptions = { name: string; tokenName: string };

// The account, and the client by the name its sign-in goes by, or all of them.
type RevokeOptions = { name: string; client: string };

// The word revoke takes for every client an account is signed in to.
export const everyClient = "all";

type DescribeWakersOptions = Access & { kind: ChannelKind };

// How a date shows to a person, like Nov 10, 2026.
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

// How each kind of client signs in as the accounts on this server.
export function signInGuide({ baseUrl, names }: SignInGuideOptions) {
  return [
    `Sign in as ${names.length === 1 ? "the account" : "each account"} from its client:`,
    ...names.map((name) => `  ${loginCommand(baseUrl)} --account ${shellQuoted(name)}`),
    `MCP clients connect to ${baseUrl}/mcp and sign in on the page it opens.`,
    "On a computer without a browser, make a token with: artil-server account token <account> <name>",
  ].join("\n");
}

export function createAccountCommands({
  accounts,
  tokens,
  addresses,
  access,
  connections,
  channels,
  confirm,
  out,
  baseUrl,
}: AccountCommandsOptions) {
  async function createAccount(name: string) {
    const account = accounts.create(name);

    out(`Created ${account.name} (${account.id}).`);
    out(signInGuide({ baseUrl: await baseUrl(), names: [account.name] }));
  }

  function listAccounts() {
    const list = accounts.list();

    if (list.length === 0) {
      out("No accounts yet. Create one with: artil-server account create <name>");

      return;
    }

    for (const account of list) {
      const listening = connections.isListening(account.id) ? "listening" : "not listening";

      const accountAddresses = addresses
        .listByAccount(account.id)
        .map(({ channel, value }) => `${channels.get(channel).name} ${value}`);

      // What differs from the default, where only the server's accounts wake the agent.
      const wakers = channels.list().flatMap(({ kind, name }) => {
        const { admit, senders } = access.read({ accountId: account.id, channel: kind });
        const listed = senders.map((sender) => channels.showSender(kind, sender)).join(", ");

        const woken = {
          anyone: "by anyone",
          team: listed && `by ${listed}`,
          list: listed ? `only by ${listed}` : "by no one",
        }[admit];

        return woken ? [`woken on ${name} ${woken}`] : [];
      });

      out(
        `${account.name}  ${[account.id, listening, ...accountAddresses, ...wakers].join(" · ")}`,
      );
    }
  }

  // Who wakes the agent on the channel, said in full.
  function describeWakers({ kind, admit, senders }: DescribeWakersOptions) {
    const listed = senders.map((sender) => channels.showSender(kind, sender)).join(", ");

    return {
      anyone: "anyone",
      team: listed ? `the server's accounts and ${listed}` : "the server's accounts",
      list: listed ? `only ${listed}` : "no one",
    }[admit];
  }

  // Everything about the account: where it is reached, the clients it is signed in to, and who
  // wakes it on each channel it has.
  async function showAccount(name: string) {
    const account = accounts.getByIdOrName(name);
    const listening = connections.isListening(account.id);
    const connection = connections.findByAccount(account.id);
    const accountAddresses = addresses.listByAccount(account.id);
    const signIns = tokens.listByAccount(account.id);
    const serverUrl = await baseUrl();

    // The client that listens through one of the sign-ins, like Claude Code on MacBook.
    const listener = connection && {
      tokenId: connection.tokenId,
      note: `${connection.machine ? `${connection.client} on ${connection.machine}` : connection.client}, ${listening ? "listening" : "not listening now"}`,
    };

    const clientRows = signIns.map(({ id, name: clientName, createdAt }) => {
      const since = `signed in ${dateFormat.format(createdAt)}`;

      return [
        clientName,
        listener?.tokenId === id ? `${since} · ${listener.note}` : since,
      ] as const;
    });

    const connectedKinds = new Set(accountAddresses.map(({ channel }) => channel));

    // The Message URL first, then each channel the account has an address on, or a list of its own
    // for, which it can have before it connects one.
    const wakerRows = [
      channels.get(urlKind),
      ...channels.list().filter(({ kind }) => kind !== urlKind),
    ].flatMap(({ kind, name: channelName }) => {
      const wakers = access.read({ accountId: account.id, channel: kind });

      const shown =
        kind === urlKind ||
        connectedKinds.has(kind) ||
        wakers.admit !== defaultAccess.admit ||
        wakers.senders.length > 0;

      return shown ? [[channelName, describeWakers({ kind, ...wakers })] as const] : [];
    });

    out(
      [
        `${account.name}  ${account.id} · ${listening ? "listening" : "not listening"}`,
        "Addresses:",
        ...toRows([
          ["Message URL", toMessageUrl({ baseUrl: serverUrl, accountId: account.id })],
          ...accountAddresses.map(
            ({ channel, value }) => [channels.get(channel).name, value] as const,
          ),
        ]),
        "Clients:",
        ...(clientRows.length > 0
          ? toRows(clientRows)
          : [
              `  none yet; sign one in with: ${loginCommand(serverUrl)} --account ${shellQuoted(account.name)}`,
            ]),
        "Who wakes it:",
        ...toRows(wakerRows),
      ].join("\n"),
    );
  }

  function renameAccount({ name, newName }: RenameAccountOptions) {
    const account = accounts.getByIdOrName(name);
    const renamed = accounts.rename({ id: account.id, name: newName });

    out(`Renamed ${account.name} to ${renamed}.`);
  }

  async function removeAccount(name: string) {
    const account = accounts.getByIdOrName(name);

    if (!(await confirm(`Remove ${account.name} with its messages and sign-ins?`))) {
      return out("Nothing changed.");
    }

    await accounts.remove(account.id);
    out(`Removed ${account.name}, with its messages and sign-ins.`);
  }

  // A token's name, which revoke takes it by; all is a word of its own there.
  function readTokenName(given: string) {
    const tokenName = given.trim();

    if (!tokenName || tokenName.toLowerCase() === everyClient) {
      throw new AppError({
        code: "invalid_input",
        message: `Name the token after where it signs in, like macbook, and not ${everyClient}`,
      });
    }

    return tokenName;
  }

  // A token for a computer without a browser, where the sign-in page cannot send its code back.
  async function issueToken({ name, tokenName }: IssueTokenOptions) {
    const account = accounts.getByIdOrName(name);
    const named = readTokenName(tokenName);
    const token = tokens.issue({ accountId: account.id, name: named });

    out(
      [
        `A token for ${account.name}, named ${named}. Keep it secret; it signs in as the account until you revoke it.`,
        `  ${loginCommand(await baseUrl())} --token ${token}`,
      ].join("\n"),
    );
  }

  async function revoke({ name, client }: RevokeOptions) {
    const account = accounts.getByIdOrName(name);
    const clients = tokens.listByAccount(account.id).map((token) => token.name);
    const wanted = client.trim().toLowerCase();

    if (wanted === everyClient) {
      if (clients.length === 0) return out(`${account.name} is signed in to no client.`);

      const each = clients.length === 1 ? "its one client" : `all ${clients.length} of its clients`;

      if (!(await confirm(`Sign ${account.name} out of ${each}?`))) return out("Nothing changed.");

      const revoked = tokens.revokeByAccount(account.id);

      return out(
        `Signed ${account.name} out of ${revoked} ${revoked === 1 ? "client" : "clients"}.`,
      );
    }

    const named = tokens.listByName({ accountId: account.id, name: client });

    if (named.length === 0) {
      throw new AppError({
        code: "not_found",
        message:
          clients.length === 0
            ? `${account.name} is signed in to no client`
            : `${account.name} has no client ${client}; it has ${clients.join(", ")}`,
      });
    }

    if (!(await confirm(`Sign ${account.name} out of ${client.trim()}?`))) {
      return out("Nothing changed.");
    }

    // Another command may have signed it out meanwhile.
    const revoked = tokens.revokeByIds(named.map(({ id }) => id));

    out(
      revoked > 0
        ? `Signed ${account.name} out of ${client.trim()}.`
        : `${account.name} was signed out of ${client.trim()} already.`,
    );
  }

  return new Map<string, Command>([
    ["account create", defineCommand({ takes: ["name"], run: ({ name }) => createAccount(name) })],
    ["account list", defineCommand({ takes: [], run: () => listAccounts() })],
    [
      "account show",
      defineCommand({ takes: ["account"], run: ({ account }) => showAccount(account) }),
    ],
    [
      "account rename",
      defineCommand({
        takes: ["account", "name"],
        run: ({ account, name }) => renameAccount({ name: account, newName: name }),
      }),
    ],
    [
      "account remove",
      defineCommand({ takes: ["account"], run: ({ account }) => removeAccount(account) }),
    ],
    [
      "account token",
      defineCommand({
        takes: ["account", "name"],
        run: ({ account, name }) => issueToken({ name: account, tokenName: name }),
      }),
    ],
    [
      "account revoke",
      defineCommand({
        takes: ["account", "client"],
        run: ({ account, client }) => revoke({ name: account, client }),
      }),
    ],
  ]);
}
