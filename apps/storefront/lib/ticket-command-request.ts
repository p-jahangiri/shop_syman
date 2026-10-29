import type { TicketCommand } from './ticket-contract.ts';
export function ticketCommandRequest(command: TicketCommand, attachment?: Blob): RequestInit {
  if (command.kind !== 'attachment')
    return {
      method: command.kind === 'state' ? 'PUT' : 'POST',
      body: JSON.stringify(command.body),
      headers: { 'Content-Type': 'application/json' },
    };
  if (
    !attachment ||
    attachment.size !== command.file.bytes ||
    attachment.type !== command.file.contentType
  )
    throw Error('Missing frozen private attachment');
  const form = new FormData();
  form.set('version', command.body.version);
  form.set('body', command.body.body);
  form.set('locale', command.body.locale);
  form.set('sha256', command.file.sha256);
  form.set('file', attachment, command.file.filename);
  return { method: 'POST', body: form };
}
