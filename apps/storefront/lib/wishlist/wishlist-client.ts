import { readWishlist, wishlistInputSchema, type WishlistData } from './wishlist-contract.ts';
export type WishlistState = {
  owner: string | null;
  data: WishlistData | null;
  busy: boolean;
  failed: boolean;
  issue: 'changed' | 'unknown' | null;
};
export class WishlistController {
  private value: WishlistState = {
    owner: null,
    data: null,
    busy: false,
    failed: false,
    issue: null,
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private fetcher: (path: string, init?: RequestInit) => Promise<Response>;
  constructor(fetcher: (path: string, init?: RequestInit) => Promise<Response>) {
    this.fetcher = fetcher;
  }
  snapshot = () => this.value;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  private set(value: WishlistState) {
    this.value = value;
    for (const f of this.listeners) f();
  }
  bind(owner: string | null) {
    owner = owner?.toUpperCase() ?? null;
    if (owner === this.value.owner) return;
    this.epoch++;
    this.set({ owner, data: null, busy: false, failed: false, issue: null });
  }
  private async read(owner: string, init?: RequestInit) {
    const response = await this.fetcher('/api/wishlist', init);
    if (!response.ok)
      throw Object.assign(Error('wishlist_unavailable'), { status: response.status });
    return readWishlist(await response.json(), owner);
  }
  async load() {
    if (!this.value.owner || this.value.busy) return;
    const owner = this.value.owner,
      ticket = ++this.epoch;
    this.set({ ...this.value, busy: true, failed: false });
    try {
      const data = await this.read(owner);
      if (ticket === this.epoch) this.set({ ...this.value, data, failed: false });
    } catch {
      if (ticket === this.epoch) this.set({ ...this.value, failed: true });
    } finally {
      if (ticket === this.epoch) this.set({ ...this.value, busy: false });
    }
  }
  async replace(ids: string[]) {
    if (!this.value.owner || !this.value.data || this.value.busy || this.value.failed) return false;
    const owner = this.value.owner,
      ticket = ++this.epoch;
    const body = wishlistInputSchema.parse({
      productIds: [...ids].sort(),
      version: this.value.data.version,
    });
    this.set({ ...this.value, busy: true, issue: null });
    try {
      const data = await this.read(owner, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (ticket !== this.epoch) return false;
      this.set({ ...this.value, data, failed: false });
      return true;
    } catch (error) {
      if (ticket !== this.epoch) return false;
      const issue = (error as { status?: number }).status === 409 ? 'changed' : 'unknown';
      this.set({ ...this.value, issue });
      try {
        const data = await this.read(owner);
        if (ticket === this.epoch) this.set({ ...this.value, data, failed: false });
      } catch {
        if (ticket === this.epoch) this.set({ ...this.value, failed: true });
      }
      return false;
    } finally {
      if (ticket === this.epoch) this.set({ ...this.value, busy: false });
    }
  }
}
