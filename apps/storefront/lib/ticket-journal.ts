import {
  readTicketResult,
  ticketCommandPath,
  type TicketCommand,
  type TicketResult,
} from './ticket-contract.ts';
import { ticketFileSelectionSchema } from './ticket-file-contract.ts';
export type TicketEntry = {
  owner: string;
  command: TicketCommand;
  state: 'pending' | 'unknown' | 'rejected' | 'done';
  result: TicketResult | null;
  code: string | null;
};
const freeze = <T>(x: T): T => {
  if (x && typeof x === 'object') {
    Object.freeze(x);
    for (const value of Object.values(x)) freeze(value);
  }
  return x;
};
export class TicketJournal {
  private owner: string | null = null;
  private entry: TicketEntry | null = null;
  private listeners = new Set<() => void>();
  private attachment: Blob | null = null;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  snapshot = (owner: string | null) => (owner !== null && owner === this.owner ? this.entry : null);
  private publish(entry: TicketEntry | null) {
    this.entry = entry ? freeze(structuredClone(entry)) : null;
    for (const f of this.listeners) f();
  }
  bind(owner: string | null) {
    if (owner !== this.owner) {
      this.owner = owner;
      this.attachment = null;
      this.publish(null);
    }
  }
  begin(owner: string, command: TicketCommand, attachment?: Blob) {
    if (
      owner !== this.owner ||
      (this.entry && this.entry.state !== 'done' && this.entry.state !== 'rejected')
    )
      throw Error('Previous private ticket command is unresolved.');
    if (command.kind === 'attachment') {
      ticketFileSelectionSchema.parse(command.file);
      if (
        !attachment ||
        attachment.size !== command.file.bytes ||
        attachment.type !== command.file.contentType
      )
        throw Error('Missing private document bytes');
      this.attachment = attachment.slice(0, attachment.size, attachment.type);
    } else this.attachment = null;
    this.publish({ owner, command, state: 'pending', result: null, code: null });
  }
  retry(owner: string) {
    const e = this.snapshot(owner);
    if (!e || e.state !== 'unknown') throw Error('No unknown ticket command.');
    this.publish({ ...e, state: 'pending' });
    return e.command;
  }
  private matches(owner: string, command: TicketCommand) {
    return (
      owner === this.owner &&
      this.entry?.command.id === command.id &&
      JSON.stringify(this.entry.command) === JSON.stringify(command)
    );
  }
  finish(owner: string, command: TicketCommand, raw: unknown) {
    if (!this.matches(owner, command)) return false;
    const result = readTicketResult(raw, command);
    this.attachment = null;
    this.publish({ ...this.entry!, state: 'done', result, code: null });
    return true;
  }
  fail(owner: string, command: TicketCommand, status: number, code: string) {
    if (!this.matches(owner, command) || this.entry?.state === 'done') return;
    const e = this.entry!;
    this.publish({
      ...e,
      state:
        e.code === 'unknown' ||
        e.state === 'unknown' ||
        status < 400 ||
        status >= 500 ||
        status === 401
          ? 'unknown'
          : 'rejected',
      code:
        e.code === 'unknown' ||
        e.state === 'unknown' ||
        status < 400 ||
        status >= 500 ||
        status === 401
          ? 'unknown'
          : code,
    });
  }
  interrupt() {
    if (this.entry?.state === 'pending')
      this.publish({ ...this.entry, state: 'unknown', code: 'unknown' });
  }
  clear(owner: string) {
    const e = this.snapshot(owner);
    if (e && ['done', 'rejected'].includes(e.state)) {
      this.attachment = null;
      this.publish(null);
    }
  }
  file(owner: string, command: TicketCommand) {
    if (
      command.kind !== 'attachment' ||
      !this.matches(owner, command) ||
      !this.attachment ||
      !['pending', 'unknown'].includes(this.entry!.state)
    )
      throw Error('Private attachment is no longer available');
    return this.attachment;
  }
  path(owner: string) {
    const e = this.snapshot(owner);
    return e ? ticketCommandPath(e.command) : null;
  }
}
export const customerTicketJournal = new TicketJournal();
