export interface RenewedAccess {
  token: string;
  expiresIn: number;
  accepted: () => void;
}
export class SessionAccess {
  token = '';
  private expiresAt = Infinity;
  private revision = 0;
  private fullAccess = false;
  private renew: (() => Promise<RenewedAccess>) | null = null;
  private flight: Promise<void> | null = null;
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }
  get generation() {
    return this.revision;
  }
  setToken(value: string, expiresIn?: number) {
    this.revision++;
    this.token = value;
    this.fullAccess =
      !!value && expiresIn !== undefined && Number.isFinite(expiresIn) && expiresIn >= 0;
    this.expiresAt =
      expiresIn === undefined ? Infinity : this.now() + Math.max(0, expiresIn) * 1000;
  }
  setRenewal(value: (() => Promise<RenewedAccess>) | null) {
    this.renew = value;
  }
  async beforeRequest(path: string) {
    if (!path.startsWith('/auth/') && (!this.token || !this.fullAccess))
      throw new SessionUnavailable();
    if (path === '/auth/refresh' || !this.token || this.expiresAt - this.now() > 60000) return;
    if (!this.flight) {
      const revision = this.revision;
      const renew = this.renew;
      if (!renew) throw new SessionUnavailable();
      this.flight = Promise.resolve()
        .then(renew)
        .then((value) => {
          // Logout, a different login, or a newer accepted token supersedes this response.
          if (this.revision !== revision || this.renew !== renew) {
            if (!this.token) throw new SessionUnavailable();
            if (this.token !== value.token) throw new SessionChanged();
            return;
          }
          if (!value.token || !Number.isFinite(value.expiresIn) || value.expiresIn <= 60)
            throw new SessionUnavailable();
          this.setToken(value.token, value.expiresIn);
          value.accepted();
        })
        .finally(() => {
          this.flight = null;
        });
    }
    await this.flight;
    if (!this.token || this.expiresAt - this.now() <= 60000) throw new SessionUnavailable();
  }
}
export class SessionUnavailable extends Error {
  constructor() {
    super('نشست معتبر نیست؛ دوباره وارد پنل شوید.');
  }
}

export class SessionChanged extends Error {
  constructor() {
    super('نشست هنگام آماده‌سازی درخواست تغییر کرد؛ فرم را با حساب فعلی دوباره بررسی کنید.');
  }
}
