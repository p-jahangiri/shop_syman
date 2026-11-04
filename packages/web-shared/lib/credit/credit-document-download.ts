import { isCreditDocumentPath } from './credit-document-contract.ts';
import {
  readPrivateFileDownload,
  type PrivateFileMetadata,
} from '../support/ticket-file-contract.ts';
export async function downloadPrivateCreditDocument(
  send: (path: string, init: RequestInit) => Promise<Response>,
  allowed: () => boolean,
  path: string,
  id: string,
  file: PrivateFileMetadata,
  signal: AbortSignal,
  staff = false,
) {
  if (
    !allowed() ||
    !isCreditDocumentPath(path, 'GET', staff) ||
    !path.endsWith('/documents/files/' + id)
  )
    throw Error('Private document view changed');
  const response = await send(path, { method: 'GET', signal });
  if (!allowed()) {
    await response.body?.cancel();
    throw Error('Private document view changed');
  }
  const blob = await readPrivateFileDownload(response, id, file);
  if (!allowed() || signal.aborted) throw Error('Private document view changed');
  return blob;
}
