// Every token signs in as one agent; the server has no member accounts.
export type Actor = { agentId: string; agentName: string; tokenHash: string; tokenName: string };

export type AuthEnv = { Variables: { actor: Actor } };
