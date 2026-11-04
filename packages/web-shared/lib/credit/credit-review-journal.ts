import {
  readCreditReviewResult,
  type CreditReviewCommand,
  type CreditReviewResult,
} from './credit-review-contract.ts';
export type CreditReviewEntry = {
  owner: string;
  command: CreditReviewCommand;
  state: 'pending' | 'unknown' | 'rejected' | 'done';
  result: CreditReviewResult | null;
  code: string | null;
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};
export class CreditReviewJournal {
  private owner: string | null = null;
  private entry: CreditReviewEntry | null = null;
  private listeners = new Set<() => void>();
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  snapshot = (owner: string | null) => (owner !== null && owner === this.owner ? this.entry : null);
  private publish(e: CreditReviewEntry | null) {
    this.entry = e ? freeze(structuredClone(e)) : null;
    for (const f of this.listeners) f();
  }
  bind(owner: string | null) {
    if (owner !== this.owner) {
      this.owner = owner;
      this.publish(null);
    }
  }
  begin(owner: string, command: CreditReviewCommand) {
    if (owner !== this.owner || (this.entry && !['done', 'rejected'].includes(this.entry.state)))
      throw Error('Resolve the previous credit requirements command');
    this.publish({ owner, command, state: 'pending', result: null, code: null });
  }
  retry(owner: string) {
    const e = this.snapshot(owner);
    if (e?.state !== 'unknown') throw Error('No unresolved requirements command');
    this.publish({ ...e, state: 'pending' });
    return e.command;
  }
  private matches(owner: string, c: CreditReviewCommand) {
    return (
      owner === this.owner &&
      this.entry?.command.id === c.id &&
      JSON.stringify(this.entry.command) === JSON.stringify(c)
    );
  }
  finish(owner: string, c: CreditReviewCommand, raw: unknown) {
    if (!this.matches(owner, c)) return false;
    this.publish({
      ...this.entry!,
      state: 'done',
      result: readCreditReviewResult(raw, c),
      code: null,
    });
    return true;
  }
  fail(owner: string, c: CreditReviewCommand, status: number, code: string) {
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
export const adminCreditReviewJournal = new CreditReviewJournal();
