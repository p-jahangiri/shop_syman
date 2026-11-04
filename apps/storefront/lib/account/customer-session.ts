import { isCustomerRmaPath } from '@sayman/web-shared/lib/orders/rma-contract.ts';
import { customerRmaJournal } from '@sayman/web-shared/lib/orders/rma-journal.ts';
import { isCustomerFulfillmentPath } from '@sayman/web-shared/lib/orders/order-parcel-contract.ts';
import { isCustomerDigitalPath } from '@sayman/web-shared/lib/orders/order-digital-contract.ts';
import { isWishlistPath } from '../wishlist/wishlist-contract.ts';
import { isCreditClearancePath } from '@sayman/web-shared/lib/credit/credit-clearance-contract.ts';
import { isChequeApprovalPath } from '@sayman/web-shared/lib/credit/cheque-approval-contract.ts';
import { isCreditUpfrontPath } from '@sayman/web-shared/lib/credit/credit-upfront-contract.ts';
import { isChequeLedgerPath } from '@sayman/web-shared/lib/credit/cheque-ledger-contract.ts';
import { isCreditSchedulePath } from '@sayman/web-shared/lib/credit/credit-schedule-contract.ts';
import { isCreditOrderPath } from '@sayman/web-shared/lib/credit/credit-order-contract.ts';
import { customerCreditOrderJournal } from '@sayman/web-shared/lib/credit/credit-order-journal.ts';
import { isCreditCheckoutQuotePath } from '@sayman/web-shared/lib/credit/credit-checkout-quote-contract.ts';
import { customerCreditCheckoutQuoteJournal } from '../credit/credit-checkout-quote-journal.ts';
import { customerCreditScopeJournal } from '@sayman/web-shared/lib/credit/credit-purchase-scope-journal.ts';
import { customerCreditSubmissionJournal } from '@sayman/web-shared/lib/credit/credit-submission-journal.ts';
import { isCreditDocumentTransfer } from '@sayman/web-shared/lib/credit/credit-document-contract.ts';
import { customerCreditDocumentJournal } from '@sayman/web-shared/lib/credit/credit-document-journal.ts';
import { customerCreditConsentJournal } from '@sayman/web-shared/lib/credit/credit-requirements-journal.ts';
import { customerCreditApplicationJournal } from '@sayman/web-shared/lib/credit/credit-application-journal.ts';
import { isCreditApplicationPath } from '@sayman/web-shared/lib/credit/credit-application-path.ts';
import { customerAuthSchema } from '../auth/customer-auth-contract.ts';
import type { CustomerSession } from '../auth/customer-auth-contract.ts';
export type { CustomerSession } from '../auth/customer-auth-contract.ts';
import { customerTicketJournal } from '@sayman/web-shared/lib/support/ticket-journal.ts';
import { isPrivateRealtimePath } from '@sayman/web-shared/lib/notifications/realtime-contract.ts';
import { isCustomerNotificationPath } from '../notifications/notification-path.ts';
import { isPhoneInterestPath } from '../market/phone-interest-path.ts';
import {
  isTicketFilePath,
  isTicketFileUpload,
} from '@sayman/web-shared/lib/support/ticket-file-contract.ts';
import { isCustomerTicketPath } from '../support/ticket-path.ts';
import { bindSourcingOwner } from '../market/sourcing-journal.ts';
import { bindQuoteV4Owner } from '../checkout/quote-v4-journal.ts';
import { bindQuoteV5Owner } from '../checkout/quote-v5-journal.ts';
import { bindOrderV2Owner } from '../orders/order-v2-journal.ts';
import { isCustomerReviewsPath } from '../reviews/reviews-path.ts';
import { isCustomerPaymentPath } from '../orders/payment-path.ts';
import { isCustomerOrderV2Path } from '../orders/order-v2-path.ts';
import { isCustomerSourcingOrdersPath } from '../market/sourcing-order-links.ts';
import { isCustomerOfferPath } from '../market/offer-path.ts';
import { isCustomerSupplyPath } from '../market/supply-path.ts';
import { isCustomerCartV2Path } from '../checkout/cart-v2-path.ts';
import { isCustomerAccountPath } from './customer-account-contract.ts';
import { otpResponseError, otpVerifySchema, OtpError } from '../auth/customer-otp-contract.ts';
export type AuthState = {
  status: 'restoring' | 'guest' | 'member' | 'unavailable';
  session: CustomerSession | null;
  expiresAt: number;
  logoutPending: boolean;
};
type SessionErrorKind = 'invalid' | 'limited' | 'unavailable' | 'changed';
export class SessionError extends Error {
  kind: SessionErrorKind;
  constructor(kind: SessionErrorKind) {
    super(kind);
    this.kind = kind;
  }
}
export type SessionTransport = (
  path: string,
  body: unknown,
  token?: string,
) => Promise<CustomerSession | undefined>;
export const initialAuthState: AuthState = {
  status: 'restoring',
  session: null,
  expiresAt: 0,
  logoutPending: false,
};
export async function authRequest(
  path: string,
  body: unknown,
  token?: string,
): Promise<CustomerSession | undefined> {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok && path === 'otp/verify') throw await otpResponseError(response);
  if (!response.ok)
    throw new SessionError(
      response.status === 401 ? 'invalid' : response.status === 429 ? 'limited' : 'unavailable',
    );
  if (response.status === 204) return undefined;
  try {
    return customerAuthSchema.parse(await response.json());
  } catch {
    throw new SessionError('unavailable');
  }
}
export async function browserSessionLock<T>(run: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('sayman-customer-refresh', run)
    : run();
}
let refreshPromise: Promise<CustomerSession | undefined> | null = null;
const sharedRefresh = () =>
  (refreshPromise ??= browserSessionLock(() => authRequest('refresh', {})).finally(() => {
    refreshPromise = null;
  }));
const logoutKey = 'sayman:logout-pending:v1';
function logoutPending(value?: boolean) {
  try {
    if (value === undefined) return sessionStorage.getItem(logoutKey) === '1';
    if (value) sessionStorage.setItem(logoutKey, '1');
    else sessionStorage.removeItem(logoutKey);
  } catch {
    /* No credentials are persisted, including when storage is restricted. */
  }
  return false;
}

export class CustomerSessionStore {
  private state: AuthState = initialAuthState;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private restoring: Promise<void> | null = null;
  private transport: SessionTransport;
  private refreshCall: () => Promise<CustomerSession | undefined>;
  private lock: <T>(run: () => Promise<T>) => Promise<T>;
  private pending: (value?: boolean) => boolean;
  private broadcast: (event: 'signin' | 'signout') => void;
  private otpLoginPending = false;
  constructor(
    transport: SessionTransport = authRequest,
    refreshCall: () => Promise<CustomerSession | undefined> = sharedRefresh,
    lock: <T>(run: () => Promise<T>) => Promise<T> = browserSessionLock,
    pending: (value?: boolean) => boolean = logoutPending,
    broadcast: (event: 'signin' | 'signout') => void = () => {},
  ) {
    this.transport = transport;
    this.refreshCall = refreshCall;
    this.lock = lock;
    this.pending = pending;
    this.broadcast = broadcast;
  }
  snapshot = () => this.state;
  // Token refresh preserves the view; logout, login and cross-tab identity
  // changes rotate this revision even when the same account signs in again.
  viewRevision = () => this.epoch;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(value: AuthState) {
    // A failed refresh does not identify another owner or establish that an
    // unanswered command failed. Keep only its frozen RAM journal until identity
    // can be verified again. Unverified states still have no session, expose no
    // journal through useSourcingCommand, and cannot use this authenticated fetch.
    if (value.status === 'member') {
      customerCreditOrderJournal.bind(value.session!.user.id);
      customerCreditCheckoutQuoteJournal.bind(value.session!.user.id);
      customerCreditScopeJournal.bind(value.session!.user.id);
      customerCreditSubmissionJournal.bind(
        value.status === 'member' ? value.session!.user.id : null,
      );
      customerCreditDocumentJournal.bind(value.session!.user.id);
      customerCreditConsentJournal.bind(value.session!.user.id);
      customerCreditApplicationJournal.bind(value.session!.user.id);
      customerTicketJournal.bind(value.session!.user.id);
      customerRmaJournal.bind(value.session!.user.id);
      bindSourcingOwner(value.session!.user.id);
      bindQuoteV4Owner(value.session!.user.id);
      bindQuoteV5Owner(value.session!.user.id);
      bindOrderV2Owner(value.session!.user.id);
    } else if (value.status === 'guest' || value.logoutPending) {
      customerCreditOrderJournal.bind(null);
      customerCreditCheckoutQuoteJournal.bind(null);
      customerCreditScopeJournal.bind(null);
      customerCreditSubmissionJournal.bind(null);
      customerCreditDocumentJournal.bind(null);
      customerCreditConsentJournal.bind(null);
      customerCreditApplicationJournal.bind(null);
      customerTicketJournal.bind(null);
      customerRmaJournal.bind(null);
      bindSourcingOwner(null);
      bindQuoteV4Owner(null);
      bindQuoteV5Owner(null);
      bindOrderV2Owner(null);
    }
    if (value.status === 'unavailable' || value.status === 'restoring') {
      customerCreditOrderJournal.interrupt();
      customerCreditCheckoutQuoteJournal.interrupt();
      customerCreditScopeJournal.interrupt();
      customerCreditSubmissionJournal.interrupt();
      customerCreditDocumentJournal.interrupt();
      customerCreditConsentJournal.interrupt();
      customerCreditApplicationJournal.interrupt();
      customerTicketJournal.interrupt();
      customerRmaJournal.interrupt();
    }
    this.state = value;
    for (const listener of this.listeners) listener();
  }
  private member(value: CustomerSession) {
    if (value.requiresMfa) throw new SessionError('invalid');
    this.set({
      status: 'member',
      session: value,
      expiresAt: Date.now() + value.expiresIn * 1000,
      logoutPending: false,
    });
  }
  restore = (background = false): Promise<void> => {
    if (this.restoring) return this.restoring;
    if (this.state.logoutPending || this.pending()) return this.logout();
    const epoch = this.epoch;
    if (!background) this.set({ ...initialAuthState });
    const task = (async () => {
      try {
        const value = await this.refreshCall();
        if (epoch !== this.epoch) return;
        if (!value) throw new SessionError('unavailable');
        this.member(value);
      } catch (e) {
        if (epoch !== this.epoch) return;
        this.set({
          status: e instanceof SessionError && e.kind === 'invalid' ? 'guest' : 'unavailable',
          session: null,
          expiresAt: 0,
          logoutPending: false,
        });
      }
    })().finally(() => {
      if (this.restoring === task) this.restoring = null;
    });
    this.restoring = task;
    return task;
  };
  login = async (identifier: string, password: string, pendingToken?: string, code?: string) => {
    if (this.state.logoutPending || this.pending()) await this.logout();
    const epoch = ++this.epoch;
    return this.lock(async () => {
      if (epoch !== this.epoch) throw new SessionError('changed');
      const value = await this.transport(
        pendingToken ? 'mfa/verify' : 'password',
        pendingToken ? { code } : { identifier, password },
        pendingToken,
      );
      if (!value) throw new SessionError('unavailable');
      if (epoch !== this.epoch) throw new SessionError('changed');
      if (!value.requiresMfa) {
        this.epoch++;
        this.pending(false);
        this.member(value);
        this.broadcast('signin');
      }
      return value;
    });
  };
  loginOtp = async (challengeId: string, code: string, current: () => boolean = () => true) => {
    const input = otpVerifySchema.safeParse({ challengeId, code });
    if (!input.success) throw new OtpError('input');
    if (this.otpLoginPending) throw new OtpError('limited');
    this.otpLoginPending = true;
    try {
      if (this.state.logoutPending || this.pending()) await this.logout();
      const epoch = ++this.epoch;
      return await this.lock(async () => {
        if (epoch !== this.epoch || !current()) throw new SessionError('changed');
        const value = await this.transport('otp/verify', input.data);
        if (!value) throw new SessionError('unavailable');
        if (epoch !== this.epoch || !current()) throw new SessionError('changed');
        // A customer's existing Authenticator requirement remains authoritative.
        // The pending token stays in memory until the ordinary MFA step succeeds.
        if (!value.requiresMfa) {
          if (value.requiresEnrollment) throw new SessionError('invalid');
          this.epoch++;
          this.pending(false);
          this.member(value);
          this.broadcast('signin');
        }
        return value;
      });
    } finally {
      this.otpLoginPending = false;
    }
  };
  logout = async () => {
    const epoch = ++this.epoch;
    this.pending(true);
    this.set({ ...initialAuthState, logoutPending: true });
    try {
      await this.lock(() =>
        epoch === this.epoch ? this.transport('logout', {}) : Promise.resolve(undefined),
      );
      if (epoch !== this.epoch) return;
      this.pending(false);
      this.set({ status: 'guest', session: null, expiresAt: 0, logoutPending: false });
      this.broadcast('signout');
    } catch {
      if (epoch !== this.epoch) return;
      this.set({ status: 'unavailable', session: null, expiresAt: 0, logoutPending: true });
      throw new SessionError('unavailable');
    }
  };
  // A password response may be lost after the server commits. End the old
  // account view in every tab even in that case, keeping failed cookie cleanup
  // explicit through the existing logout-pending state. Never affect a new owner.
  credentialsChanged = async (owner: string, revision: number): Promise<boolean> => {
    if (
      this.epoch !== revision ||
      this.state.status !== 'member' ||
      this.state.session?.user.id !== owner
    )
      return false;
    this.broadcast('signout');
    try {
      await this.logout();
    } catch (error) {
      if (this.epoch === revision + 1) throw error;
      return false;
    }
    return this.epoch === revision + 1;
  };
  remote = (event: 'signin' | 'signout') => {
    this.epoch++;
    this.restoring = null;
    if (event === 'signout') {
      this.pending(false);
      this.set({ status: 'guest', session: null, expiresAt: 0, logoutPending: false });
    } else {
      this.pending(false);
      this.set({ ...initialAuthState });
      void this.restore().catch(() => {});
    }
  };
  fetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
    if (
      !(
        isCustomerRmaPath(path, init.method ?? 'GET') ||
        isCustomerAccountPath(path, init.method ?? 'GET') ||
        isCustomerFulfillmentPath(path, init.method ?? 'GET') ||
        isCustomerDigitalPath(path, init.method ?? 'GET') ||
        isWishlistPath(path, init.method ?? 'GET') ||
        isCreditClearancePath(path, init.method ?? 'GET') ||
        isChequeApprovalPath(path, init.method ?? 'GET') ||
        isCreditUpfrontPath(path, init.method ?? 'GET') ||
        isChequeLedgerPath(path, init.method ?? 'GET') ||
        isCreditSchedulePath(path, init.method ?? 'GET') ||
        isCreditOrderPath(path, init.method ?? 'GET') ||
        isCreditCheckoutQuotePath(path, init.method ?? 'GET') ||
        isCreditApplicationPath(path, init.method ?? 'GET') ||
        isTicketFilePath(path, init.method ?? 'GET') ||
        isPrivateRealtimePath(path, init.method ?? 'GET') ||
        isCustomerNotificationPath(path, init.method ?? 'GET') ||
        isPhoneInterestPath(path, init.method ?? 'GET') ||
        isCustomerTicketPath(path, init.method ?? 'GET') ||
        isCustomerPaymentPath(path, init.method ?? 'GET') ||
        isCustomerReviewsPath(path, init.method ?? 'GET') ||
        isCustomerSourcingOrdersPath(path, init.method ?? 'GET') ||
        isCustomerOrderV2Path(path, init.method ?? 'GET') ||
        isCustomerCartV2Path(path, init.method ?? 'GET') ||
        isCustomerSupplyPath(path, init.method ?? 'GET') ||
        isCustomerOfferPath(path) ||
        /^\/api\/addresses(?:\/[a-f0-9]{32})?$/.test(path) ||
        /^\/api\/cart\/(fa|en)(\/(merge|quote)|\/sourcing(?:\/submit)?)?$/.test(path) ||
        /^\/api\/sourcing\/requests(?:\?cursor=[A-Za-z0-9_-]{1,200})?$/.test(path) ||
        /^\/api\/sourcing\/requests\/commands\/(?:submit|cancel)\/(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
          path,
        ) ||
        /^\/api\/sourcing\/requests\/[a-f0-9]{32}(?:\/cancel|\/events(?:\?cursor=[A-Za-z0-9_-]{1,200})?)?$/.test(
          path,
        ) ||
        /^\/api\/orders(?:\?cursor=[A-Za-z0-9_-]{1,200})?$/.test(path) ||
        /^\/api\/orders\/[a-f0-9]{32}(?:\/cancel)?$/.test(path)
      ) ||
      this.state.status === 'restoring' ||
      this.state.status === 'unavailable'
    )
      throw new SessionError('unavailable');
    const owner = this.state.session?.user.id ?? null;
    const epoch = this.epoch;
    const sameIdentity = () =>
      epoch === this.epoch &&
      (this.state.status === 'member'
        ? this.state.session?.user.id === owner
        : this.state.status === 'guest' && owner === null);
    const run = () => {
      const headers = new Headers(init.headers);
      headers.delete('Authorization');
      if (this.state.session)
        headers.set('Authorization', `Bearer ${this.state.session.accessToken}`);
      return fetch(path, {
        ...init,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: init.signal
          ? AbortSignal.any([
              init.signal,
              AbortSignal.timeout(
                isTicketFileUpload(path, init.method ?? 'GET') ||
                  isCreditDocumentTransfer(path, init.method ?? 'GET')
                  ? 45000
                  : 15000,
              ),
            ])
          : AbortSignal.timeout(
              isTicketFileUpload(path, init.method ?? 'GET') ||
                isCreditDocumentTransfer(path, init.method ?? 'GET')
                ? 45000
                : 15000,
            ),
      });
    };
    let response = await run();
    if (!sameIdentity()) throw new SessionError('changed');
    if (response.status === 401 && owner) {
      await this.restore(true);
      if (
        epoch !== this.epoch ||
        this.state.status !== 'member' ||
        this.state.session?.user.id !== owner
      )
        throw new SessionError('changed');
      response = await run();
    }
    if (!sameIdentity()) throw new SessionError('changed');
    return response;
  };
}
