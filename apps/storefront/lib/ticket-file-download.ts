import {
  isTicketFilePath,
  readPrivateFileDownload,
  type PrivateFileMetadata,
} from './ticket-file-contract.ts';
export type TicketDownloadTransport = (
  path: string,
  id: string,
  metadata: PrivateFileMetadata,
  signal: AbortSignal,
) => Promise<Blob>;
export async function downloadPrivateTicketFile(
  send: (path: string, init: RequestInit) => Promise<Response>,
  allowed: () => boolean,
  path: string,
  id: string,
  metadata: PrivateFileMetadata,
  signal: AbortSignal,
  staff = false,
) {
  if (!allowed() || !isTicketFilePath(path, 'GET', staff) || !path.endsWith('/attachments/' + id))
    throw Error('Private download view changed');
  const response = await send(path, { method: 'GET', signal });
  if (!allowed()) {
    await response.body?.cancel();
    throw Error('Private download view changed');
  }
  const blob = await readPrivateFileDownload(response, id, metadata);
  if (!allowed() || signal.aborted) throw Error('Private download view changed');
  return blob;
}
