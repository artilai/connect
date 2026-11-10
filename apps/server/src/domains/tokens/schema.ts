// Every token signs in as one account; the server has no members.
export type Actor = {
  accountId: string;
  accountName: string;
  tokenHash: string;
  tokenName: string;
};

export type AuthEnv = { Variables: { actor: Actor } };
