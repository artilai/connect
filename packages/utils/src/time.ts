export const second = 1000;

export const minute = 60 * second;

export const hour = 60 * minute;

// Waits, or stops waiting once the signal aborts.
export function abortableSleep(milliseconds: number, signal: AbortSignal) {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, milliseconds);

  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );

  return promise;
}
