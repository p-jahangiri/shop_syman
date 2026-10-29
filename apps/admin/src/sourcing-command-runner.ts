import type { QueryClient } from '@tanstack/react-query';
import {
  commandTarget,
  freezeCommand,
  maySendCommand,
  sourcingFailureIsUnknown,
  type AdminSourcingCommand,
} from './sourcing-admin-command.ts';
import { adminViewRevision } from './admin-view-authority.ts';

export type CommandFocus = {
  requestId?: string;
  offerId?: string;
  taskId?: string;
  mappingId?: string;
  receiptId?: string;
  allocationId?: string;
};
export type CommandCacheUpdate = { key: readonly unknown[]; value: unknown };
export interface CommandAdapter {
  path: string;
  method: 'PUT' | 'POST';
  receiptPath: string;
  permitted: boolean;
  validate: (value: unknown, receipt: boolean) => void;
  readFresh: () => Promise<{
    updates: CommandCacheUpdate[];
    focus: CommandFocus;
    invalidate: readonly (readonly unknown[])[];
  }>;
}
export interface CommandRunnerOptions {
  client: QueryClient;
  viewerId: string;
  adapter: (command: AdminSourcingCommand) => CommandAdapter;
  active: () => boolean;
  onFocus?: (value: CommandFocus) => void;
  // Undefined clears an earlier attempt's page error; journal state remains authoritative.
  onError?: (error: unknown) => void;
  status?: (error: unknown) => number | null;
}
const key = (viewer: string) => ['admin', 'sourcing-command', viewer] as const;
type Flight = { busy: boolean; listeners: Set<() => void> };
const flights = new WeakMap<QueryClient, Map<string, Flight>>();
function flight(client: QueryClient, viewer: string) {
  let map = flights.get(client);
  if (!map) {
    map = new Map();
    flights.set(client, map);
  }
  let value = map.get(viewer);
  if (!value) {
    value = { busy: false, listeners: new Set() };
    map.set(viewer, value);
  }
  return value;
}
export function sourcingRunnerBusy(client: QueryClient, viewer: string) {
  return flight(client, viewer).busy;
}
export function subscribeSourcingRunner(client: QueryClient, viewer: string, listener: () => void) {
  const state = flight(client, viewer);
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}
function setBusy(state: Flight, value: boolean) {
  state.busy = value;
  for (const listener of state.listeners) listener();
}
const same = (left: AdminSourcingCommand | null | undefined, right: AdminSourcingCommand) =>
  !!left &&
  left.id === right.id &&
  left.kind === right.kind &&
  JSON.stringify(commandTarget(left)) === JSON.stringify(commandTarget(right)) &&
  JSON.stringify(left.body) === JSON.stringify(right.body);
const unknownMessage =
  'پاسخ قطعی دریافت نشد؛ فرمان و شناسهٔ آن در حافظهٔ همین نشست حفظ شده‌اند. تلاش دوباره دقیقاً همین فرمان را می‌فرستد.';
const refreshMessage =
  'فرمان با نتیجهٔ قطعی ثبت شد؛ تا دریافت موفق وضعیت جاری، عملیات تازه بسته است.';

// The mutex belongs to the QueryClient and verified account, not a mounted
// page. Navigating between sales and inventory cannot create another writer.
export function createSourcingCommandRunner(options: CommandRunnerOptions) {
  const { client, viewerId } = options,
    state = flight(client, viewerId),
    viewRevision = adminViewRevision();
  const active = () => options.active() && adminViewRevision() === viewRevision;
  const current = () => client.getQueryData<AdminSourcingCommand | null>(key(viewerId));
  const report = (error: unknown) => {
    if (active()) options.onError?.(error);
  };
  function known(command: AdminSourcingCommand) {
    if (!same(current(), command)) return false;
    client.setQueryData(key(viewerId), {
      ...command,
      phase: 'refresh',
      uncertain: false,
      message: refreshMessage,
    });
    return true;
  }
  async function sync(command: AdminSourcingCommand, adapter: CommandAdapter) {
    if (!active() || !same(current(), command) || current()?.phase !== 'refresh') return false;
    const fresh = await adapter.readFresh();
    if (!active() || !same(current(), command) || current()?.phase !== 'refresh') return false;
    // No private GET result is applied after unmount/auth invalidation. The
    // historical known command may remain for the next verified page to refresh.
    for (const update of fresh.updates) {
      await client.cancelQueries({ queryKey: update.key });
      if (!active() || !same(current(), command) || current()?.phase !== 'refresh') return false;
    }
    report(undefined);
    for (const update of fresh.updates) client.setQueryData(update.key, update.value);
    client.setQueryData(key(viewerId), null);
    options.onFocus?.(fresh.focus);
    for (const queryKey of fresh.invalidate) void client.invalidateQueries({ queryKey });
    return true;
  }
  async function finish(command: AdminSourcingCommand, adapter: CommandAdapter) {
    if (!known(command)) return false;
    try {
      return await sync(command, adapter);
    } catch {
      report(
        new Error(
          'ثبت فرمان تأیید شد، اما وضعیت جاری دریافت نشد. «دریافت وضعیت پس از ثبت» را بزنید؛ فرمان دوباره ارسال نمی‌شود.',
        ),
      );
      return false;
    }
  }
  return {
    discardFailed(command: AdminSourcingCommand, invalidate: readonly (readonly unknown[])[]) {
      const adapter = options.adapter(command),
        stored = current();
      if (
        !active() ||
        !adapter.permitted ||
        state.busy ||
        command.phase !== 'failed' ||
        stored?.phase !== 'failed' ||
        stored.uncertain ||
        !same(stored, command)
      )
        return false;
      // Mark stock-dependent editors stale before opening the slot. Their active
      // reads start now; an unavailable GET keeps the corresponding editor locked.
      for (const queryKey of invalidate) void client.invalidateQueries({ queryKey });
      report(undefined);
      client.setQueryData(key(viewerId), null);
      return true;
    },
    async send(
      command: AdminSourcingCommand,
      write: (path: string, body: unknown, method: 'PUT' | 'POST') => Promise<unknown>,
    ) {
      const adapter = options.adapter(command),
        previous = current();
      if (!active() || !adapter.permitted || state.busy || !maySendCommand(previous, command))
        return false;
      setBusy(state, true);
      report(undefined);
      const frozen = freezeCommand(command),
        uncertain =
          frozen.uncertain === true ||
          frozen.phase === 'unknown' ||
          (frozen.phase === 'pending' && previous?.id === frozen.id);
      client.setQueryData(key(viewerId), {
        ...frozen,
        uncertain,
        phase: 'pending',
        message: undefined,
      });
      try {
        const raw = await write(adapter.path, frozen.body, adapter.method);
        adapter.validate(raw, false);
        return await finish(frozen, adapter);
      } catch (error) {
        const stored = current();
        if (!same(stored, frozen)) return false;
        const unknown = sourcingFailureIsUnknown(
          uncertain || stored?.uncertain === true || stored?.phase === 'unknown',
          options.status?.(error) ?? null,
        );
        client.setQueryData(key(viewerId), {
          ...frozen,
          uncertain: unknown,
          phase: unknown ? 'unknown' : 'failed',
          message: unknown
            ? unknownMessage
            : error instanceof Error
              ? error.message
              : 'فرمان پذیرفته نشد؛ وضعیت تازه را بررسی کنید.',
        });
        report(error);
        return false;
      } finally {
        setBusy(state, false);
      }
    },
    async refresh(command: AdminSourcingCommand) {
      const adapter = options.adapter(command);
      if (
        !active() ||
        !adapter.permitted ||
        state.busy ||
        command.phase !== 'refresh' ||
        !same(current(), command)
      )
        return false;
      setBusy(state, true);
      report(undefined);
      try {
        return await finish(command, adapter);
      } finally {
        setBusy(state, false);
      }
    },
    async recover(command: AdminSourcingCommand, read: (path: string) => Promise<unknown>) {
      const adapter = options.adapter(command),
        stored = current();
      if (
        !active() ||
        state.busy ||
        !adapter.permitted ||
        (stored && (!same(stored, command) || stored.phase === 'refresh'))
      )
        return false;
      setBusy(state, true);
      report(undefined);
      let found = false;
      try {
        const raw = await read(adapter.receiptPath);
        adapter.validate(raw, true);
        found = true;
        // A manual receipt may start without a RAM command. Install only the
        // read-only refresh phase after its target-bound receipt was verified.
        if (!stored) {
          if (!active() || current()) return false;
          client.setQueryData(key(viewerId), {
            ...freezeCommand(command),
            phase: 'refresh',
            uncertain: false,
            message: refreshMessage,
          });
        }
        return await finish(command, adapter);
      } catch (error) {
        report(
          found
            ? new Error(
                'رسید موفق تأیید شد، اما دریافت وضعیت جاری کامل نشد؛ اطلاعات تازه را دوباره دریافت کنید.',
              )
            : options.status?.(error) === 404
              ? new Error(
                  'رسید هنوز پیدا نشد. این نتیجه پایان فرمان در حال اجرا را ثابت نمی‌کند؛ با همان شناسه پیگیری کنید.',
                )
              : error,
        );
        return false;
      } finally {
        setBusy(state, false);
      }
    },
  };
}
