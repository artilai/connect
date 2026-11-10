type Listener = () => void;

// Tells the streams of an account that it has a new event; the one server process writes them all.
export function createEventBus() {
  const listeners = new Map<string, Set<Listener>>();

  return {
    publish(accountId: string) {
      for (const listener of listeners.get(accountId) ?? []) listener();
    },

    subscribe(accountId: string, listener: Listener) {
      const accountListeners = listeners.get(accountId) ?? new Set();

      accountListeners.add(listener);
      listeners.set(accountId, accountListeners);

      return () => {
        accountListeners.delete(listener);

        if (accountListeners.size === 0) listeners.delete(accountId);
      };
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;
