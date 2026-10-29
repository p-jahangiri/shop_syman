import {
  clearanceCommandSchema,
  readClearanceResult,
  type ClearanceCommand,
  type ClearanceResult,
} from './credit-clearance-contract.ts';
export type ClearanceEntry = {
  actor: string;
  command: ClearanceCommand;
  state: 'pending' | 'unknown' | 'rejected' | 'done';
  result: ClearanceResult | null;
  code: string | null;
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};
export class CreditClearanceJournal {
  private actor: string | null = null;
  private entry: ClearanceEntry | null = null;
  private listeners = new Set<() => void>();
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  snapshot = (actor: string | null) => (actor !== null && actor === this.actor ? this.entry : null);
  private publish(entry: ClearanceEntry | null) {
    this.entry = entry ? freeze(structuredClone(entry)) : null;
    for (const f of this.listeners) f();
  }
  bind(actor: string | null) {
    if (actor !== this.actor) {
      this.actor = actor;
      this.publish(null);
    }
  }
  begin(actor: string, command: ClearanceCommand) {
    if (actor !== this.actor || (this.entry && !['done', 'rejected'].includes(this.entry.state)))
      throw Error('Resolve the prior clearance command');
    this.publish({
      actor,
      command: clearanceCommandSchema.parse(command),
      state: 'pending',
      result: null,
      code: null,
    });
  }
  retry(actor: string) {
    const e = this.snapshot(actor);
    if (e?.state !== 'unknown') throw Error('No unresolved clearance command');
    this.publish({ ...e, state: 'pending' });
    return e.command;
  }
  private matches(actor: string, command: ClearanceCommand) {
    return (
      actor === this.actor &&
      this.entry?.command.id === command.id &&
      JSON.stringify(this.entry.command) === JSON.stringify(command)
    );
  }
  finish(actor: string, command: ClearanceCommand, raw: unknown) {
    if (!this.matches(actor, command)) return false;
    this.publish({
      ...this.entry!,
      state: 'done',
      result: readClearanceResult(raw, command),
      code: null,
    });
    return true;
  }
  fail(actor: string, command: ClearanceCommand, status: number, code: string) {
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
