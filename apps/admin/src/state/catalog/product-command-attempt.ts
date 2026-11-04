import type { ProductReceipt } from '../../api/contracts/catalog/product-workspace-contract';
export interface ProductCommandAttempt {
  viewerId: string;
  requestId: string;
  kind: ProductReceipt['kind'];
  productId: string | null;
  phase: 'pending' | 'unknown' | 'confirmed' | 'rejected';
}
let current: ProductCommandAttempt | null = null;
// Public catalogue drafts may be retained only in this tab's RAM so an explicit
// retry uses the exact same command. Nothing is written to browser storage.
let transport: { path: string; method: 'POST' | 'PUT'; body: unknown } | null = null;
let revision = 0;
const listeners = new Set<() => void>();
function changed() {
  revision++;
  for (const listener of listeners) listener();
}
export function subscribeProductCommands(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function productCommandRevision() {
  return revision;
}
export function productCommandAttempt(viewerId: string) {
  return current?.viewerId === viewerId ? { ...current } : null;
}
export function productCommandTransport(viewerId: string) {
  return current?.viewerId === viewerId && transport ? structuredClone(transport) : null;
}
export function beginProductCommand(
  value: Omit<ProductCommandAttempt, 'phase'>,
  request?: { path: string; method: 'POST' | 'PUT'; body: unknown },
) {
  if (
    current?.viewerId === value.viewerId &&
    (current.phase === 'pending' || current.phase === 'unknown')
  )
    throw new Error('ابتدا رسید تلاش قبلی را بررسی کنید.');
  current = { ...value, phase: 'pending' };
  transport = request ? structuredClone(request) : null;
  changed();
}
export function finishProductCommand(
  viewerId: string,
  id: string,
  phase: ProductCommandAttempt['phase'],
) {
  if (current?.viewerId === viewerId && current.requestId === id) {
    current = { ...current, phase };
    if (phase === 'confirmed' || phase === 'rejected') transport = null;
    changed();
  }
}
export function interruptProductCommand(viewerId: string) {
  if (current?.viewerId === viewerId && current.phase === 'pending')
    finishProductCommand(viewerId, current.requestId, 'unknown');
}
