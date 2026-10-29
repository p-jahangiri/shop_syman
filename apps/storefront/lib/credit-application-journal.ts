import {
  readCreditApplicationResult,
  type CreditApplicationCommand,
  type CreditApplicationResult,
} from './credit-application-contract.ts';
export type CreditApplicationEntry = {
  owner: string;
  command: CreditApplicationCommand;
  state: 'pending' | 'unknown' | 'rejected' | 'done';
  result: CreditApplicationResult | null;
  code: string | null;
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};
export class CreditApplicationJournal {
  private owner: string | null = null;
  private entry: CreditApplicationEntry | null = null;
  private listeners = new Set<() => void>();
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  snapshot = (owner: string | null) => (owner !== null && owner === this.owner ? this.entry : null);
  private publish(e: CreditApplicationEntry | null) {
    this.entry = e ? freeze(structuredClone(e)) : null;
    for (const f of this.listeners) f();
  }
  bind(owner: string | null) {
    if (owner !== this.owner) {
      this.owner = owner;
      this.publish(null);
    }
  }
  begin(owner: string, command: CreditApplicationCommand) {
    if (owner !== this.owner || (this.entry && !['done', 'rejected'].includes(this.entry.state)))
      throw Error('Resolve the previous private credit command');
    this.publish({ owner, command, state: 'pending', result: null, code: null });
  }
  retry(owner: string) {
    const e = this.snapshot(owner);
    if (e?.state !== 'unknown') throw Error('No unresolved credit command');
    this.publish({ ...e, state: 'pending' });
    return e.command;
  }
  private matches(owner: string, c: CreditApplicationCommand) {
    return (
      owner === this.owner &&
      this.entry?.command.id === c.id &&
      JSON.stringify(this.entry.command) === JSON.stringify(c)
    );
  }
  finish(owner: string, c: CreditApplicationCommand, raw: unknown) {
    if (!this.matches(owner, c)) return false;
    this.publish({
      ...this.entry!,
      state: 'done',
      result: readCreditApplicationResult(raw, c),
      code: null,
    });
    return true;
  }
  fail(owner: string, c: CreditApplicationCommand, status: number, code: string) {
    if (!this.matches(owner, c) || this.entry?.state === 'done') return;
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
  clear(owner: string) {
    const e = this.snapshot(owner);
    if (e && ['done', 'rejected'].includes(e.state)) this.publish(null);
  }
}
export const customerCreditApplicationJournal = new CreditApplicationJournal();
