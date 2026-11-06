import { minute } from "@artil/utils/time";

const maxFailures = 5;

type CreatePasswordCheckOptions = {
  // Reads the hash the server keeps, so a new password counts at once; without one, the sign-in
  // page asks for no password.
  hash: () => Promise<string | null>;
  now?: () => number;
};

// The password the sign-in page asks for, with a pause after a few wrong guesses so nobody can try
// many.
export function createPasswordCheck({ hash, now = Date.now }: CreatePasswordCheckOptions) {
  let failures: number[] = [];

  return {
    required: async () => (await hash()) !== null,

    async check(given: string): Promise<"right" | "wrong" | "paused"> {
      const expected = await hash();

      if (expected === null) return "right";

      // From here on nothing waits, so guesses made at once still count one by one.
      failures = failures.filter((at) => now() - at < minute);

      if (failures.length >= maxFailures) return "paused";

      if (given !== "" && Bun.password.verifySync(given, expected)) return "right";

      failures.push(now());

      return "wrong";
    },
  };
}

export type PasswordCheck = ReturnType<typeof createPasswordCheck>;

// The sign-in page's password is at least 8 characters long.
export function validatePassword(password: string | undefined) {
  return (password?.length ?? 0) >= 8 ? undefined : "Use at least 8 characters";
}

export function hashPassword(password: string) {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}
