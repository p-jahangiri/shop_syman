// No identity, token, role, draft or command crosses this channel. A message
// only removes local authority; it can never authenticate or renew a session.
export const adminLogoutChannel = 'sayman-admin-logout-v1';
export interface AdminLogoutPort {
  postMessage(value: unknown): void;
  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  close(): void;
}
export function isAdminLogoutSignal(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && v.type === 'logout' && v.version === 1;
}
export function connectAdminLogoutSync(
  onLogout: () => void,
  make: () => AdminLogoutPort | null = () =>
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(adminLogoutChannel),
) {
  let active = true,
    port: AdminLogoutPort | null = null;
  try {
    port = make();
  } catch {
    /* Explicit local logout remains available when channels are unavailable. */
  }
  const receive = (event: MessageEvent) => {
    if (active && isAdminLogoutSignal(event.data)) onLogout();
  };
  port?.addEventListener('message', receive);
  return {
    publish() {
      if (active)
        try {
          port?.postMessage({ type: 'logout', version: 1 });
        } catch {
          /* Never delay local logout for a tab transport. */
        }
    },
    close() {
      if (!active) return;
      active = false;
      port?.removeEventListener('message', receive);
      port?.close();
    },
  };
}
