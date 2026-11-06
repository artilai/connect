/** @jsxImportSource hono/jsx */
import type { PropsWithChildren } from "hono/jsx";

const styles = `
  :root { color-scheme: light dark; --line: #d4d4d8; --muted: #71717a; --accent: #18181b; --on-accent: #fafafa; --error: #b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --line: #3f3f46; --muted: #a1a1aa; --accent: #fafafa; --on-accent: #18181b; --error: #f87171; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; font: 15px/1.5 system-ui, sans-serif; }
  main { width: 100%; max-width: 400px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: var(--muted); }
  code { font: 13px ui-monospace, monospace; }
  fieldset { border: 1px solid var(--line); border-radius: 10px; margin: 0 0 16px; padding: 4px 12px; }
  legend { padding: 0 4px; font-weight: 600; }
  label.agent { display: flex; gap: 10px; align-items: center; padding: 8px 0; }
  label.agent + label.agent { border-top: 1px solid var(--line); }
  label.password { display: grid; gap: 6px; margin: 0 0 16px; font-weight: 600; }
  input[type=password] { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; }
  .error { color: var(--error); }
  .actions { display: flex; gap: 8px; }
  button { font: inherit; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button[value=allow] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
`;

type LayoutProps = PropsWithChildren<{ title: string }>;

function Layout({ title, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{title}</title>
        <style>{styles}</style>
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}

type Agent = { id: string; name: string };

export type SignInPageProps = {
  // Who asks to act as an agent, like an MCP client or the artil CLI on a computer.
  client: string;
  // Where the code goes, so the person can tell a client from one that only borrows its name.
  redirectHost: string;
  agents: readonly Agent[];
  selectedAgentId: string | undefined;
  askPassword: boolean;
  error: string | undefined;
};

export function SignInPage({
  client,
  redirectHost,
  agents,
  selectedAgentId,
  askPassword,
  error,
}: SignInPageProps) {
  const checkedAgentId = agents.find(({ id }) => id === selectedAgentId)?.id ?? agents[0]?.id;

  return (
    <Layout title="Sign in to Artil Server">
      <h1>Sign in to Artil Server</h1>
      <p>
        <strong>{client}</strong> wants to act as one of this server's agents. It gets the answer at{" "}
        <code>{redirectHost}</code>.
      </p>
      <form method="post">
        {agents.length === 0 ? (
          <p>
            This server has no agents yet. Make one on the server with{" "}
            <code>artil-server account create &lt;name&gt;</code>, then sign in again.
          </p>
        ) : (
          <fieldset>
            <legend>Act as</legend>
            {agents.map(({ id, name }) => (
              <label class="agent">
                <input
                  type="radio"
                  name="agent"
                  value={id}
                  checked={id === checkedAgentId}
                  required
                />
                {name}
              </label>
            ))}
          </fieldset>
        )}
        {askPassword && agents.length > 0 && (
          <label class="password">
            Server password
            <input type="password" name="password" autocomplete="current-password" required />
          </label>
        )}
        {error && <p class="error">{error}</p>}
        <div class="actions">
          {agents.length > 0 && (
            <button type="submit" name="decision" value="allow">
              Allow
            </button>
          )}
          <button type="submit" name="decision" value="deny" formnovalidate>
            Deny
          </button>
        </div>
      </form>
    </Layout>
  );
}

export function ExpiredPage() {
  return (
    <Layout title="Sign-in expired">
      <h1>This sign-in has expired</h1>
      <p>It was used already or waited too long. Start signing in again from the client.</p>
    </Layout>
  );
}
