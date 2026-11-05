type Listener = () => void;

// Tells the streams of an agent that it has a new event; the one server process writes them all.
export function createEventBus() {
  const listeners = new Map<string, Set<Listener>>();

  return {
    publish(agentId: string) {
      for (const listener of listeners.get(agentId) ?? []) listener();
    },

    subscribe(agentId: string, listener: Listener) {
      const agentListeners = listeners.get(agentId) ?? new Set();

      agentListeners.add(listener);
      listeners.set(agentId, agentListeners);

      return () => {
        agentListeners.delete(listener);

        if (agentListeners.size === 0) listeners.delete(agentId);
      };
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;
