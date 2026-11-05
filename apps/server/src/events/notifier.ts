// Wakes a stream that waits for a new event, and remembers a notification that came before it
// waited.
export function createNotifier() {
  let notified = false;
  let wakeWaiter: (() => void) | undefined;

  return {
    notify() {
      notified = true;
      wakeWaiter?.();
    },

    // Says whether a notification came before the timeout.
    wait(timeout: number) {
      const { promise, resolve } = Promise.withResolvers<boolean>();

      function finishWaiting() {
        clearTimeout(timer);
        wakeWaiter = undefined;
        resolve(notified);
        notified = false;
      }

      const timer = setTimeout(finishWaiting, timeout);

      if (notified) finishWaiting();
      else wakeWaiter = finishWaiting;

      return promise;
    },
  };
}
