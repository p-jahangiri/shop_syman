import {
  cmsPageCommandSchema,
  readCmsPageResult,
  type CmsPageCommand,
  type CmsPageResult,
} from './cms-page-contract.ts';
export type CmsPageEntry = {
  actor: string;
  command: CmsPageCommand;
  state: 'pending' | 'unknown' | 'rejected' | 'done';
  result: CmsPageResult | null;
  code: string | null;
};
const freeze = <T>(v: T): T => {
  if (v && typeof v === 'object') {
    Object.freeze(v);
    for (const x of Object.values(v)) freeze(x);
  }
  return v;
};
export class CmsPageJournal {
  private actor: string | null = null;
  private entry: CmsPageEntry | null = null;
  private listeners = new Set<() => void>();
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  snapshot = (actor: string | null) => (actor !== null && actor === this.actor ? this.entry : null);
  private publish(entry: CmsPageEntry | null) {
    this.entry = entry ? freeze(structuredClone(entry)) : null;
    for (const f of this.listeners) f();
  }
  bind(actor: string | null) {
    if (actor !== this.actor) {
      this.actor = actor;
      this.publish(null);
    }
  }
  begin(actor: string, command: CmsPageCommand) {
    if (actor !== this.actor || (this.entry && !['done', 'rejected'].includes(this.entry.state)))
      throw Error('Resolve the previous page command');
    this.publish({
      actor,
      command: cmsPageCommandSchema.parse(command),
      state: 'pending',
      result: null,
      code: null,
    });
  }
  retry(actor: string) {
    const e = this.snapshot(actor);
    if (e?.state !== 'unknown') throw Error('No unresolved page command');
    this.publish({ ...e, state: 'pending' });
    return e.command;
  }
  private matches(actor: string, c: CmsPageCommand) {
    return (
      actor === this.actor &&
      this.entry?.command.id === c.id &&
      JSON.stringify(this.entry.command) === JSON.stringify(c)
    );
  }
  finish(actor: string, c: CmsPageCommand, raw: unknown) {
    if (!this.matches(actor, c)) return false;
    const result = readCmsPageResult(raw, c);
    this.publish({ ...this.entry!, state: 'done', result, code: null });
    return true;
  }
  fail(actor: string, c: CmsPageCommand, status: number, code: string) {
    if (!this.matches(actor, c) || this.entry?.state === 'done') return;
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
