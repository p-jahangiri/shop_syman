import {
  parcelCommandSchema,
  readParcelResult,
  type ParcelCommand,
  type ParcelResult,
} from '@sayman/web-shared/lib/orders/order-parcel-contract.ts';
export type ParcelEntry = {
  actor: string;
  command: ParcelCommand;
  state: 'pending' | 'unknown' | 'rejected' | 'done';
  result: ParcelResult | null;
  code: string | null;
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};
export class OrderParcelJournal {
  private actor: string | null = null;
  private entry: ParcelEntry | null = null;
  private listeners = new Set<() => void>();
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  snapshot = (actor: string | null) => (actor !== null && actor === this.actor ? this.entry : null);
  private publish(entry: ParcelEntry | null) {
    this.entry = entry ? freeze(structuredClone(entry)) : null;
    for (const f of this.listeners) f();
  }
  bind(actor: string | null) {
    if (actor !== this.actor) {
      this.actor = actor;
      this.publish(null);
    }
  }
  begin(actor: string, command: ParcelCommand) {
    if (actor !== this.actor || (this.entry && !['done', 'rejected'].includes(this.entry.state)))
      throw Error('Resolve the prior parcel command');
    this.publish({
      actor,
      command: parcelCommandSchema.parse(command),
      state: 'pending',
      result: null,
      code: null,
    });
  }
  retry(actor: string) {
    const e = this.snapshot(actor);
    if (e?.state !== 'unknown') throw Error('No unresolved parcel command');
    this.publish({ ...e, state: 'pending' });
    return e.command;
  }
  private matches(actor: string, command: ParcelCommand) {
    return (
      actor === this.actor &&
      this.entry?.command.input.commandId === command.input.commandId &&
      JSON.stringify(this.entry.command) === JSON.stringify(command)
    );
  }
  finish(actor: string, command: ParcelCommand, raw: unknown) {
    if (!this.matches(actor, command)) return false;
    this.publish({
      ...this.entry!,
      state: 'done',
      result: readParcelResult(raw, command),
      code: null,
    });
    return true;
  }
  fail(actor: string, command: ParcelCommand, status: number, code: string) {
    if (!this.matches(actor, command) || this.entry?.state === 'done') return;
    const unknown =
      this.entry!.code === 'unknown' ||
      this.entry!.state === 'unknown' ||
      status < 400 ||
      status >= 500 ||
      status === 401;
    this.publish({
      ...this.entry!,
      state: unknown ? 'unknown' : 'rejected',
      code: unknown ? 'unknown' : code,
    });
  }
  interrupt() {
    if (this.entry?.state === 'pending')
      this.publish({ ...this.entry, state: 'unknown', code: 'unknown' });
  }
  clear(actor: string) {
    const e = this.snapshot(actor);
    if (e && ['done', 'rejected'].includes(e.state)) this.publish(null);
  }
}

export const orderParcelJournal = new OrderParcelJournal();
