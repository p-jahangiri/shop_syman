'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { Button } from '../shared/ui';
import {
  updateCustomerProfileSchema,
  changeCustomerPasswordSchema,
  type CustomerAccountProfile,
} from '@/lib/account/customer-account-contract';
import {
  CustomerAccountError,
  readCustomerAccount,
  updateCustomerProfile,
  changeCustomerPassword,
} from '@/lib/account/customer-account-client';
import './account-settings.css';

export function AccountSettings({
  profile,
  onProfileChanged,
  onPasswordChanged,
}: {
  profile: CustomerAccountProfile;
  onProfileChanged: (profile: CustomerAccountProfile) => void;
  onPasswordChanged: (outcome: 'changed' | 'unknown') => Promise<void>;
}) {
  const auth = useCustomerSession(),
    { store } = auth,
    { locale } = useI18n(),
    owner = profile.id,
    revision = store.viewRevision(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [displayName, setDisplayName] = useState(profile.displayName),
    [currentPassword, setCurrentPassword] = useState(''),
    [newPassword, setNewPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [showCurrent, setShowCurrent] = useState(false),
    [showNew, setShowNew] = useState(false),
    [showConfirmation, setShowConfirmation] = useState(false),
    [busy, setBusy] = useState<'profile' | 'password' | 'reload' | null>(null),
    [profileMessage, setProfileMessage] = useState(''),
    [profileError, setProfileError] = useState(''),
    [passwordError, setPasswordError] = useState(''),
    [requiresReload, setRequiresReload] = useState(false),
    [relogin, setRelogin] = useState<'changed' | 'unknown' | null>(null);
  const controller = useRef<AbortController | null>(null),
    mounted = useRef(false),
    inFlight = useRef(false),
    reloginPending = useRef<'changed' | 'unknown' | null>(null);

  useEffect(() => {
    mounted.current = true;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmation('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirmation(false);
    setBusy(null);
    setPasswordError('');
    setProfileError('');
    setProfileMessage('');
    setRequiresReload(false);
    setRelogin(null);
    reloginPending.current = null;
    inFlight.current = false;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      controller.current = null;
    };
  }, [owner, revision]);
  useEffect(() => setDisplayName(profile.displayName), [profile.displayName, profile.version]);

  function sameIdentity() {
    const state = store.snapshot();
    return (
      store.viewRevision() === revision &&
      state.status === 'member' &&
      state.session?.user.id === owner
    );
  }
  function current(abort?: AbortController) {
    return mounted.current && !abort?.signal.aborted && sameIdentity();
  }
  function clearPasswords() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmation('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirmation(false);
  }
  function issue(error: unknown) {
    if (!(error instanceof CustomerAccountError)) return 'unavailable';
    if (error.status === 429) return 'limited';
    if ([401, 403].includes(error.status)) return 'signin';
    if (error.status === 409) return 'conflict';
    if (error.code === 'invalid_current_password') return 'current';
    if (error.code === 'password_policy') return 'policy';
    if (error.code === 'password_unchanged') return 'unchanged';
    if (error.status === 400) return 'invalid';
    return 'unavailable';
  }
  const issueText = (value: string) => {
    switch (value) {
      case 'limited':
        return text(
          'تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید.',
          'Too many attempts. Please wait before trying again.',
        );
      case 'signin':
        return text(
          'نشست شما نیاز به بررسی دوباره دارد؛ دوباره وارد حساب شوید.',
          'Your session needs to be checked again. Please sign in again.',
        );
      case 'current':
        return text(
          'رمز فعلی صحیح نیست. رمزها را دوباره وارد کنید.',
          'The current password is incorrect. Please enter your passwords again.',
        );
      case 'policy':
        return text(
          'رمز جدید باید دست‌کم ۱۲ نویسه و شامل حرف بزرگ و کوچک انگلیسی، عدد و نشانه باشد.',
          'Use at least 12 characters, including uppercase and lowercase English letters, a number and a symbol.',
        );
      case 'unchanged':
        return text(
          'رمز جدید باید با رمز فعلی متفاوت باشد.',
          'The new password must be different from your current password.',
        );
      case 'confirmation':
        return text(
          'تکرار رمز با رمز جدید مطابقت ندارد.',
          'The password confirmation does not match.',
        );
      case 'name':
        return text(
          'نام نمایشی را با ۱ تا ۲۰۰ نویسهٔ معتبر وارد کنید.',
          'Enter a valid display name between 1 and 200 characters.',
        );
      case 'conflict':
        return text(
          'اطلاعات حساب در جای دیگری تغییر کرده بود. نسخهٔ تازه دریافت شد؛ تغییر موردنظرتان را دوباره بررسی کنید.',
          'Your account was changed elsewhere. The current details are loaded; review your changes before saving again.',
        );
      case 'reload':
        return text(
          'برای بررسی نتیجهٔ تغییر، ابتدا اطلاعات تازهٔ حساب را دریافت کنید.',
          'Load your current account details before making another change.',
        );
      case 'invalid':
        return text(
          'اطلاعات پذیرفته نشد؛ فیلدها را بررسی و دوباره وارد کنید.',
          'The details were not accepted. Check the fields and enter them again.',
        );
      default:
        return text(
          'پاسخ سرویس دریافت نشد. اطلاعات تازه را بگیرید و نتیجه را بررسی کنید.',
          'The service response was not received. Load current details to check the result.',
        );
    }
  };
  async function loadProfile(abort: AbortController) {
    const value = await readCustomerAccount(store.fetch, owner, abort.signal);
    if (!current(abort) || value.id !== owner) return false;
    onProfileChanged(value);
    setDisplayName(value.displayName);
    setRequiresReload(false);
    return true;
  }
  async function reloadProfile() {
    if (inFlight.current || !current() || reloginPending.current) return;
    inFlight.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy('reload');
    setProfileError('');
    setProfileMessage('');
    try {
      if (await loadProfile(abort))
        setProfileMessage(
          text('اطلاعات تازهٔ حساب دریافت شد.', 'Your current account details are loaded.'),
        );
    } catch (error) {
      if (current(abort)) {
        setRequiresReload(true);
        setProfileError(issue(error));
      }
    } finally {
      if (current(abort)) {
        setBusy(null);
        inFlight.current = false;
      }
    }
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !current() || requiresReload || reloginPending.current) return;
    const parsed = updateCustomerProfileSchema.safeParse({
      displayName: displayName.trim(),
      version: profile.version,
    });
    setProfileMessage('');
    if (!parsed.success) {
      setProfileError('name');
      return;
    }
    inFlight.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy('profile');
    setProfileError('');
    try {
      const value = await updateCustomerProfile(store.fetch, owner, parsed.data, abort.signal);
      if (!current(abort) || value.id !== owner) return;
      onProfileChanged(value);
      setDisplayName(value.displayName);
      setProfileMessage(text('نام نمایشی شما ذخیره شد.', 'Your display name was saved.'));
    } catch (error) {
      if (!current(abort)) return;
      const kind = issue(error);
      if (kind === 'conflict') {
        setRequiresReload(true);
        try {
          if (await loadProfile(abort)) setProfileError('conflict');
        } catch {
          if (current(abort)) setProfileError('reload');
        }
      } else {
        if (kind === 'unavailable') setRequiresReload(true);
        setProfileError(kind);
      }
    } finally {
      if (current(abort)) {
        setBusy(null);
        inFlight.current = false;
      }
    }
  }
  async function finishPassword(outcome: 'changed' | 'unknown') {
    if (!sameIdentity()) return;
    reloginPending.current = outcome;
    if (mounted.current) {
      setRelogin(outcome);
      clearPasswords();
    }
    try {
      await onPasswordChanged(outcome);
    } catch {
      // Keep the form locked if cookie cleanup needs another attempt.
      if (mounted.current && sameIdentity())
        setPasswordError(
          text(
            'برای ادامه، خروج و ورود دوباره را کامل کنید.',
            'Complete sign-out and sign in again to continue.',
          ),
        );
    }
  }
  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !current() || !profile.passwordEnabled || reloginPending.current)
      return;
    const parsed = changeCustomerPasswordSchema.safeParse({ currentPassword, newPassword });
    setPasswordError('');
    if (!parsed.success) {
      setPasswordError(issueText('policy'));
      return;
    }
    if (newPassword !== confirmation) {
      setPasswordError(issueText('confirmation'));
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError(issueText('unchanged'));
      return;
    }
    inFlight.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy('password');
    try {
      await changeCustomerPassword(store.fetch, parsed.data, abort.signal);
      if (sameIdentity()) await finishPassword('changed');
    } catch (error) {
      if (!sameIdentity()) return;
      if (
        !(error instanceof CustomerAccountError) ||
        error.status >= 500 ||
        [401, 403].includes(error.status)
      )
        await finishPassword('unknown');
      else if (current(abort)) setPasswordError(issueText(issue(error)));
    } finally {
      if (mounted.current && sameIdentity()) clearPasswords();
      if (current(abort)) {
        setBusy(null);
        inFlight.current = false;
      }
    }
  }
  const locked = busy !== null || relogin !== null;
  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    visible: boolean,
    onVisible: () => void,
    autoComplete: 'current-password' | 'new-password',
  ) => (
    <div className="field customer-account-password-field">
      <label htmlFor={id}>{label}</label>
      <div className="customer-account-password-input">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          dir="ltr"
          autoComplete={autoComplete}
          minLength={autoComplete === 'new-password' ? 12 : 1}
          maxLength={128}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={locked}
          aria-describedby="account-password-guidance"
          aria-invalid={passwordError ? true : undefined}
          required
        />
        <button
          type="button"
          className="customer-account-password-visibility"
          aria-label={text(
            visible ? `پنهان کردن ${label}` : `نمایش ${label}`,
            `${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`,
          )}
          aria-controls={id}
          aria-pressed={visible}
          onClick={onVisible}
          disabled={locked}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
  if (auth.status !== 'member' || auth.session?.user.id !== owner) return null;
  return (
    <div className="customer-account-settings">
      <section className="customer-account-setting-card" aria-labelledby="account-profile-title">
        <div className="customer-account-setting-heading">
          <span className="customer-account-setting-icon">
            <UserRound size={21} />
          </span>
          <div>
            <h2 id="account-profile-title">{text('اطلاعات شخصی', 'Personal details')}</h2>
            <p>
              {text(
                'نامی که در حساب و ارتباط با پشتیبانی نمایش داده می‌شود.',
                'The name shown in your account and conversations with support.',
              )}
            </p>
          </div>
        </div>
        <form onSubmit={saveProfile} className="customer-account-setting-form">
          <div className="field">
            <label htmlFor="account-display-name">{text('نام نمایشی', 'Display name')}</label>
            <input
              id="account-display-name"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={200}
              required
              disabled={locked || requiresReload}
              aria-invalid={profileError === 'name' ? true : undefined}
              aria-describedby={profileError ? 'account-profile-error' : undefined}
            />
          </div>
          <div className="customer-account-setting-actions">
            <Button
              type="submit"
              disabled={locked || requiresReload || displayName.trim() === profile.displayName}
            >
              <Check size={16} />
              {busy === 'profile'
                ? text('در حال ذخیره…', 'Saving…')
                : text('ذخیرهٔ نام', 'Save name')}
            </Button>
            {requiresReload && (
              <Button variant="outline" onClick={() => void reloadProfile()} disabled={locked}>
                <RefreshCw size={16} />
                {busy === 'reload'
                  ? text('در حال دریافت…', 'Loading…')
                  : text('دریافت اطلاعات تازه', 'Load current details')}
              </Button>
            )}
          </div>
          {profileError && (
            <p id="account-profile-error" role="alert" className="field-error">
              {issueText(profileError)}
            </p>
          )}
          {profileMessage && (
            <p role="status" className="customer-account-setting-success">
              <Check size={16} />
              {profileMessage}
            </p>
          )}
        </form>
        <dl className="customer-account-contact-list">
          <div>
            <dt>{text('نام کاربری', 'Username')}</dt>
            <dd>
              <bdi dir="ltr">{profile.userName}</bdi>
            </dd>
          </div>
          <div>
            <dt>{text('ایمیل', 'Email')}</dt>
            <dd>
              {profile.email ? (
                <bdi dir="ltr">{profile.email}</bdi>
              ) : (
                <span>{text('ثبت نشده', 'Not provided')}</span>
              )}
              {profile.email && (
                <span
                  className="customer-account-verification"
                  data-verified={profile.emailConfirmed}
                >
                  {profile.emailConfirmed
                    ? text('تأیید شده', 'Verified')
                    : text('تأیید نشده', 'Not verified')}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>{text('شمارهٔ همراه', 'Mobile number')}</dt>
            <dd>
              {profile.phoneNumber ? (
                <bdi dir="ltr">{profile.phoneNumber}</bdi>
              ) : (
                <span>{text('ثبت نشده', 'Not provided')}</span>
              )}
              {profile.phoneNumber && (
                <span
                  className="customer-account-verification"
                  data-verified={profile.phoneNumberConfirmed}
                >
                  {profile.phoneNumberConfirmed
                    ? text('تأیید شده', 'Verified')
                    : text('تأیید نشده', 'Not verified')}
                </span>
              )}
            </dd>
          </div>
        </dl>
        <p className="customer-account-setting-note">
          {text(
            'ایمیل، شمارهٔ همراه و نام کاربری در این بخش قابل تغییر نیستند. تغییر راه‌های ورود به تأیید هویت نیاز دارد.',
            'Email, mobile number and username cannot be changed here. Changes to sign-in details require identity verification.',
          )}
        </p>
      </section>
      <section className="customer-account-setting-card" aria-labelledby="account-security-title">
        <div className="customer-account-setting-heading">
          <span className="customer-account-setting-icon">
            <ShieldCheck size={21} />
          </span>
          <div>
            <h2 id="account-security-title">{text('امنیت حساب', 'Account security')}</h2>
            <p>
              {text(
                'رمز عبور و وضعیت تأیید دومرحله‌ای حساب شما.',
                'Your password and two-step verification status.',
              )}
            </p>
          </div>
        </div>
        <dl className="customer-account-contact-list customer-account-security-status">
          <div>
            <dt>{text('رمز عبور', 'Password')}</dt>
            <dd>
              {profile.passwordEnabled ? text('تنظیم شده', 'Set') : text('تنظیم نشده', 'Not set')}
            </dd>
          </div>
          <div>
            <dt>{text('تأیید دومرحله‌ای', 'Two-step verification')}</dt>
            <dd>
              {profile.twoFactorEnabled
                ? text('فعال', 'Enabled')
                : text('فعال نیست', 'Not enabled')}
            </dd>
          </div>
        </dl>
        {profile.passwordEnabled ? (
          <form className="customer-account-setting-form" onSubmit={savePassword}>
            <h3>
              <KeyRound size={17} />
              {text('تغییر رمز عبور', 'Change password')}
            </h3>
            <p id="account-password-guidance" className="customer-account-setting-note">
              {text(
                'رمز جدید دست‌کم ۱۲ نویسه و شامل حرف بزرگ و کوچک انگلیسی، عدد و نشانه باشد. پس از تغییر رمز، از همهٔ دستگاه‌ها خارج می‌شوید و باید دوباره وارد شوید.',
                'Use at least 12 characters, including uppercase and lowercase English letters, a number and a symbol. Changing your password signs you out on every device; you will need to sign in again.',
              )}
            </p>
            {field(
              'account-current-password',
              text('رمز فعلی', 'Current password'),
              currentPassword,
              setCurrentPassword,
              showCurrent,
              () => setShowCurrent((value) => !value),
              'current-password',
            )}
            <div className="customer-account-password-pair">
              {field(
                'account-new-password',
                text('رمز جدید', 'New password'),
                newPassword,
                setNewPassword,
                showNew,
                () => setShowNew((value) => !value),
                'new-password',
              )}
              {field(
                'account-confirm-password',
                text('تکرار رمز جدید', 'Confirm new password'),
                confirmation,
                setConfirmation,
                showConfirmation,
                () => setShowConfirmation((value) => !value),
                'new-password',
              )}
            </div>
            <div className="customer-account-setting-actions">
              <Button type="submit" disabled={locked}>
                {busy === 'password'
                  ? text('در حال تغییر…', 'Changing…')
                  : text('تغییر رمز و ورود دوباره', 'Change password and sign in again')}
              </Button>
            </div>
            {passwordError && (
              <p role="alert" className="field-error">
                {passwordError}
              </p>
            )}
            {relogin && (
              <p role="status" className="notice">
                {relogin === 'changed'
                  ? text(
                      'رمز تغییر کرد. برای ادامه دوباره وارد شوید.',
                      'Your password changed. Sign in again to continue.',
                    )
                  : text(
                      'نتیجهٔ تغییر رمز دریافت نشد. برای بررسی، دوباره وارد شوید؛ در صورت تغییر، رمز جدید را به کار ببرید.',
                      'The password change result was not received. Sign in again to check; use the new password if the change completed.',
                    )}
              </p>
            )}
          </form>
        ) : (
          <p className="customer-account-setting-note">
            {text(
              'تغییر رمز در این حساب در دسترس نیست. راه‌اندازی یا بازیابی رمز به تأیید هویت نیاز دارد.',
              'Password changes are unavailable for this account. Setting or recovering a password requires identity verification.',
            )}
          </p>
        )}
      </section>
    </div>
  );
}
