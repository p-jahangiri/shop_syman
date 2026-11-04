import {
  normalizeIranMobile,
  normalizeOtpDigits,
  otpChallengeSchema,
  otpTiming,
  otpVerifySchema,
  OtpError,
  requestOtp,
  type OtpChallenge,
  type OtpErrorKind,
  type OtpRequest,
} from './customer-otp-contract.ts';
import type { CustomerSession } from '../account/customer-session.ts';

export type OtpState = {
  mobile: string;
  code: string;
  challenge: OtpChallenge | null;
  busy: 'request' | 'verify' | null;
  error: OtpErrorKind | null;
  unknownRequest: boolean;
};
export type OtpVerifier = (
  challengeId: string,
  code: string,
  current: () => boolean,
) => Promise<CustomerSession>;
const initial: OtpState = {
  mobile: '',
  code: '',
  challenge: null,
  busy: null,
  error: null,
  unknownRequest: false,
};

// Short-lived, component-owned memory only. A synchronous gate prevents two
// submits before React renders. Generations also fence phone edits/unmounts;
// the session store independently fences logout and cross-tab identity changes.
export class CustomerOtpFlow {
  private state: OtpState = { ...initial };
  private listeners = new Set<() => void>();
  private generation = 0;
  private active = true;
  private unresolved: OtpRequest | null = null;
  private challengeRevision: number | null = null;
  private verifyCall: OtpVerifier;
  private revision: () => number;
  private request: (input: OtpRequest) => Promise<OtpChallenge>;
  private now: () => number;
  private newId: () => string;
  constructor(
    verifyCall: OtpVerifier,
    revision: () => number,
    request: (input: OtpRequest) => Promise<OtpChallenge> = requestOtp,
    now: () => number = Date.now,
    newId: () => string = () => crypto.randomUUID().replaceAll('-', ''),
  ) {
    this.verifyCall = verifyCall;
    this.revision = revision;
    this.request = request;
    this.now = now;
    this.newId = newId;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(patch: Partial<OtpState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  setMobile = (mobile: string) => {
    this.generation++;
    this.unresolved = null;
    this.challengeRevision = null;
    this.set({ ...initial, mobile });
  };
  setCode = (code: string) => {
    if (this.state.busy) return;
    this.set({ code: normalizeOtpDigits(code), error: null });
  };
  activate = () => {
    this.active = true;
  };
  dispose = () => {
    this.active = false;
    this.generation++;
    this.unresolved = null;
    this.challengeRevision = null;
    this.state = { ...initial };
    this.listeners.clear();
  };
  requestCode = async () => {
    if (!this.active || this.state.busy) return;
    const mobile = normalizeIranMobile(this.state.mobile);
    if (!mobile) return this.set({ error: 'input' });
    if (this.state.challenge && otpTiming(this.state.challenge, this.now()).resendIn > 0)
      return this.set({ error: 'cooldown' });
    const generation = this.generation,
      revision = this.revision(),
      current = () => this.active && generation === this.generation && revision === this.revision();
    // A lost response is retried manually with the same idempotency key. An
    // ordinary explicit resend after resendAt gets a fresh request ID.
    const input = this.unresolved ?? { mobile, requestId: this.newId() };
    this.unresolved = input;
    this.set({ busy: 'request', error: null, code: '' });
    try {
      const challenge = otpChallengeSchema.parse(await this.request(input));
      if (!current()) return;
      this.unresolved = null;
      this.challengeRevision = revision;
      this.set({ challenge, unknownRequest: false });
    } catch (error) {
      if (!current()) return;
      const kind = error instanceof OtpError ? error.kind : 'unknown';
      const retain = ['unknown', 'cooldown', 'limited'].includes(kind);
      if (!retain) this.unresolved = null;
      this.set({ error: kind, unknownRequest: retain });
    } finally {
      if (current()) this.set({ busy: null });
      else if (this.active && generation === this.generation) {
        this.unresolved = null;
        this.challengeRevision = null;
        this.set({ ...initial, mobile: this.state.mobile, error: 'changed' });
      }
    }
  };
  verify = async (): Promise<CustomerSession | null> => {
    if (!this.active || this.state.busy) return null;
    if (this.challengeRevision !== this.revision()) {
      this.challengeRevision = null;
      this.unresolved = null;
      this.set({ ...initial, mobile: this.state.mobile, error: 'changed' });
      return null;
    }
    const challenge = this.state.challenge;
    if (!challenge || otpTiming(challenge, this.now()).expiresIn === 0) {
      this.set({ error: 'expired', code: '' });
      return null;
    }
    const input = otpVerifySchema.safeParse({
      challengeId: challenge.challengeId,
      code: this.state.code,
    });
    if (!input.success) {
      this.set({ error: 'input' });
      return null;
    }
    const generation = this.generation;
    const current = () => this.active && generation === this.generation;
    this.set({ busy: 'verify', error: null });
    let verificationRevision = this.revision();
    try {
      const task = this.verifyCall(input.data.challengeId, input.data.code, current);
      verificationRevision = this.revision();
      const value = await task;
      if (!current()) return null;
      this.unresolved = null;
      this.challengeRevision = null;
      this.set({ code: '', challenge: null, unknownRequest: false });
      return value;
    } catch (error) {
      if (!current()) return null;
      if (verificationRevision !== this.revision()) {
        this.challengeRevision = null;
        this.unresolved = null;
        this.set({ ...initial, mobile: this.state.mobile, error: 'changed' });
        return null;
      }
      this.challengeRevision = verificationRevision;
      const kind =
        error instanceof OtpError
          ? error.kind
          : error instanceof Error && error.message === 'changed'
            ? 'changed'
            : 'unavailable';
      this.set({ error: kind, code: '' });
      return null;
    } finally {
      if (current()) this.set({ busy: null });
    }
  };
}
