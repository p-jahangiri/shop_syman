import {
  creditDocumentCommandSchema,
  readCreditDocumentResult,
  type CreditDocumentCommand,
  type CreditDocumentResult,
} from './credit-document-contract.ts';
export type CreditDocumentEntry = {
  owner: string;
  command: CreditDocumentCommand;
  state: 'pending' | 'unknown' | 'rejected' | 'done';
  result: CreditDocumentResult | null;
  code: string | null;
};
const freeze = <T>(v: T): T => {
  if (v && typeof v === 'object') {
    Object.freeze(v);
    for (const item of Object.values(v)) freeze(item);
  }
  return v;
};
export class CreditDocumentJournal {
  private owner: string | null = null;
  private entry: CreditDocumentEntry | null = null;
  private bytes: Blob | null = null;
  private listeners = new Set<() => void>();
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  snapshot = (owner: string | null) => (owner !== null && owner === this.owner ? this.entry : null);
  private publish(e: CreditDocumentEntry | null) {
    this.entry = e ? freeze(structuredClone(e)) : null;
    for (const f of this.listeners) f();
  }
  bind(owner: string | null) {
    if (owner !== this.owner) {
      this.owner = owner;
      this.bytes = null;
      this.publish(null);
    }
  }
  begin(owner: string, c: CreditDocumentCommand, bytes: Blob) {
    if (owner !== this.owner || (this.entry && !['done', 'rejected'].includes(this.entry.state)))
      throw Error('Resolve the previous document command');
    creditDocumentCommandSchema.parse(c);
    if (bytes.size !== c.file.bytes || bytes.type !== c.file.contentType)
      throw Error('Missing private document bytes');
    this.bytes = bytes.slice(0, bytes.size, bytes.type);
    this.publish({ owner, command: c, state: 'pending', result: null, code: null });
  }
  retry(owner: string) {
    const e = this.snapshot(owner);
    if (e?.state !== 'unknown') throw Error('No unresolved credit document');
    this.publish({ ...e, state: 'pending' });
    return e.command;
  }
  private matches(owner: string, c: CreditDocumentCommand) {
    return (
      owner === this.owner &&
      this.entry?.command.id === c.id &&
      JSON.stringify(this.entry.command) === JSON.stringify(c)
    );
  }
  file(owner: string, c: CreditDocumentCommand) {
    if (
      !this.matches(owner, c) ||
      !this.bytes ||
      !['pending', 'unknown'].includes(this.entry!.state)
    )
      throw Error('Private document no longer available');
    return this.bytes;
  }
  finish(owner: string, c: CreditDocumentCommand, raw: unknown) {
    if (!this.matches(owner, c)) return false;
    const result = readCreditDocumentResult(raw, c);
    this.bytes = null;
    this.publish({ ...this.entry!, state: 'done', result, code: null });
    return true;
  }
  fail(owner: string, c: CreditDocumentCommand, status: number, code: string) {
    if (!this.matches(owner, c) || this.entry?.state === 'done') return;
    const unknown =
      this.entry!.code === 'unknown' ||
      this.entry!.state === 'unknown' ||
      status < 400 ||
      status >= 500 ||
      status === 401;
    if (!unknown) this.bytes = null;
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
    if (e && ['done', 'rejected'].includes(e.state)) {
      this.bytes = null;
      this.publish(null);
    }
  }
}
export const customerCreditDocumentJournal = new CreditDocumentJournal();
