import { SessionChanged } from '../auth/session-access.ts';

// Retain the previous refresh lock name so already-open clients that use that
// lock still order their refresh cookie writes against the new auth transport.
export const adminAuthLockName = 'sayman-admin-refresh';
export type AuthLockRunner = <T>(signal: AbortSignal, operation: () => Promise<T>) => Promise<T>;
function deadline(milliseconds: number, parent?: AbortSignal | null) {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      parent?.reason ?? new DOMException('Authentication request was cancelled.', 'AbortError'),
    );
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('Authentication transport timed out.', 'TimeoutError')),
    milliseconds,
  );
  return {
    signal: controller.signal,
    close: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}
type Waiting = { start: () => void; signal: AbortSignal; cancel: () => void };
// One queue for every auth operation, including when navigator.locks is absent.
// The browser lock additionally orders the shared cookie across same-origin tabs.
export class AdminAuthTransport {
  private queue: Waiting[] = [];
  private active = false;
  private readonly options: { withLock?: AuthLockRunner; waitMs?: number; networkMs?: number };
  constructor(options: { withLock?: AuthLockRunner; waitMs?: number; networkMs?: number } = {}) {
    this.options = options;
  }
  private local<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: Waiting = {
        signal,
        cancel: () => {
          this.queue = this.queue.filter((item) => item !== entry);
          reject(signal.reason);
        },
        start: () => {
          signal.removeEventListener('abort', entry.cancel);
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          this.active = true;
          Promise.resolve()
            .then(operation)
            .then(resolve, reject)
            .finally(() => {
              this.active = false;
              this.pump();
            });
        },
      };
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', entry.cancel, { once: true });
      this.queue.push(entry);
      this.pump();
    });
  }
  private pump() {
    while (!this.active && this.queue.length) {
      const entry = this.queue.shift()!;
      entry.start();
    }
  }
  async run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    stillCurrent: () => boolean,
    parent?: AbortSignal | null,
  ): Promise<T> {
    const waiting = deadline(this.options.waitMs ?? 15000, parent);
    const execute = async () => {
      waiting.close();
      if (waiting.signal.aborted) throw waiting.signal.reason;
      // An old queued MFA/password/refresh intent must never reach the wire after
      // logout or another login changed the bearer/session generation.
      if (!stillCurrent()) throw new SessionChanged();
      const network = deadline(this.options.networkMs ?? 10000, parent);
      try {
        if (network.signal.aborted) throw network.signal.reason;
        return await operation(network.signal);
      } finally {
        network.close();
      }
    };
    try {
      return await (this.options.withLock
        ? this.options.withLock(waiting.signal, execute)
        : this.local(waiting.signal, execute));
    } finally {
      waiting.close();
    }
  }
}
