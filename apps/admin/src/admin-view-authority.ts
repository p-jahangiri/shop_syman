// A verified authorization boundary applies synchronously, before React can
// unmount an old page. Reads may be aborted; an already-sent write must retain
// its historical outcome and account-bound command journal.
let revision = 0;
let reads = new AbortController();
export const adminViewRevision = () => revision;
export const adminViewReadSignal = () => reads.signal;
export function invalidateAdminViews() {
  revision++;
  reads.abort();
  reads = new AbortController();
}
