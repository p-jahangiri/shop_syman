import {
  reviewHoldCommandSchema,
  readReviewHoldResult,
  type ReviewHoldCommand,
  type ReviewHoldResult,
} from './cheque-review-hold-contract.ts';
export type ReviewHoldEntry = {
  actor: string;
  command: ReviewHoldCommand;
  state: 'pending' | 'unknown' | 'rejected' | 'done';
  result: ReviewHoldResult | null;
  code: string | null;
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};
export class ChequeReviewHoldJournal {
  private actor: string | null = null;
  private entry: ReviewHoldEntry | null = null;
  private listeners = new Set<() => void>();
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  snapshot = (actor: string | null) => (actor !== null && actor === this.actor ? this.entry : null);
  private publish(entry: ReviewHoldEntry | null) {
    this.entry = entry ? freeze(structuredClone(entry)) : null;
    for (const f of this.listeners) f();
  }
  bind(actor: string | null) {
    if (actor !== this.actor) {
      this.actor = actor;
      this.publish(null);
    }
  }
  begin(actor: string, command: ReviewHoldCommand) {
    if (actor !== this.actor || (this.entry && !['done', 'rejected'].includes(this.entry.state)))
      throw Error('Resolve the prior reviewHold command');
    this.publish({
      actor,
      command: reviewHoldCommandSchema.parse(command),
      state: 'pending',
      result: null,
      code: null,
    });
  }
  retry(actor: string) {
    const e = this.snapshot(actor);
    if (e?.state !== 'unknown') throw Error('No unresolved reviewHold command');
    this.publish({ ...e, state: 'pending' });
    return e.command;
  }
  private matches(actor: string, command: ReviewHoldCommand) {
    return (
      actor === this.actor &&
      this.entry?.command.id === command.id &&
      JSON.stringify(this.entry.command) === JSON.stringify(command)
    );
  }
  finish(actor: string, command: ReviewHoldCommand, raw: unknown) {
    if (!this.matches(actor, command)) return false;
    this.publish({
      ...this.entry!,
      state: 'done',
      result: readReviewHoldResult(raw, command),
      code: null,
    });
    return true;
  }
  fail(actor: string, command: ReviewHoldCommand, status: number, code: string) {
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
