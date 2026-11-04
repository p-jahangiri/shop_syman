'use client';
import Link from '@/components/navigation/localized-link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  UserRound,
  Package,
  MapPin,
  Heart,
  LogOut,
  ShieldCheck,
  Smartphone,
  KeyRound,
  Eye,
  EyeOff,
  MessageCircle,
  CreditCard,
} from 'lucide-react';
import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import { useShop } from '../providers/shop-provider';
import { Button, groupNavigation } from '../shared/ui';
import { ConnectedAccount } from './connected-account';
import { isPurchaseKindEnabled } from '@/lib/catalog/purchasing';

type Screen = 'login' | 'otp' | 'register' | 'reset' | 'account';
export function Account() {
  const { dataSource } = useStorefront();
  return dataSource === 'api' ? <ConnectedAccount /> : <PreviewAccount />;
}
function PreviewAccount() {
  const { t, digits } = useI18n();
  const { authSettings, purchaseMethods } = useStorefront();
  const chequeEnabled = isPurchaseKindEnabled(purchaseMethods, 'cheque');
  const { wishlist } = useShop();
  const params = useSearchParams();
  const [screen, setScreen] = useState<Screen>('login'),
    [method, setMethod] = useState(authSettings.mobileOtp ? 'otp' : 'password'),
    [tab, setTab] = useState(params.get('tab') === 'orders' ? 'orders' : 'overview');
  const [identifier, setIdentifier] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [showPassword, setShowPassword] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [registration, setRegistration] = useState({
    name: '',
    username: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  });
  const passwordEnabled = authSettings.emailPassword || authSettings.usernamePassword;
  const activeTab = tab === 'credit' && !chequeEnabled ? 'overview' : tab;
  function changeScreen(next: Screen) {
    setScreen(next);
    setError('');
    setMessage('');
    setPassword('');
    setCode('');
    setShowPassword(false);
    setRegistration({ name: '', username: '', email: '', phone: '', password: '', confirm: '' });
  }
  function clearSensitive() {
    setIdentifier('');
    setPassword('');
    setCode('');
    setRegistration({ name: '', username: '', email: '', phone: '', password: '', confirm: '' });
  }
  function login(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (method === 'otp') {
      if (!/^09\d{9}$/.test(normalizePersian(identifier).replace(/\s/g, ''))) {
        setError(t('شماره موبایل معتبر وارد کنید.'));
        return;
      }
      changeScreen('otp');
      return;
    }
    if (!identifier.trim() || !password) {
      setError(t('شناسه و رمز عبور را وارد کنید.'));
      return;
    }
    const email = identifier.includes('@');
    if ((email && !authSettings.emailPassword) || (!email && !authSettings.usernamePassword)) {
      setError(t('این روش ورود در تنظیمات فروشگاه فعال نیست.'));
      return;
    }
    if (
      !['demo@sayman.local', 'demo'].includes(identifier.trim().toLowerCase()) ||
      password !== 'SaymanDemo!2026'
    ) {
      setError(t('برای پیش‌نمایش از حساب نمونهٔ نمایش‌داده‌شده استفاده کنید.'));
      return;
    }
    clearSensitive();
    changeScreen('account');
  }
  function verify(e: FormEvent) {
    e.preventDefault();
    if (normalizePersian(code) !== '123456') {
      setError(t('کد نمایشی ۱۲۳۴۵۶ است.'));
      return;
    }
    clearSensitive();
    changeScreen('account');
  }
  function register(e: FormEvent) {
    e.preventDefault();
    if (
      registration.name.trim().length < 3 ||
      !/^\S+@\S+\.\S+$/.test(registration.email.trim()) ||
      !/^09\d{9}$/.test(normalizePersian(registration.phone).replace(/\s/g, '')) ||
      !/^[a-zA-Z0-9._-]{3,32}$/.test(registration.username)
    ) {
      setError(t('نام، ایمیل، شماره موبایل و نام کاربری معتبر وارد کنید.'));
      return;
    }
    if (
      registration.password.length < 12 ||
      registration.password.length > 128 ||
      registration.password !== registration.confirm
    ) {
      setError(t('رمز حداقل ۱۲ نویسه باشد و با تکرار آن مطابقت داشته باشد.'));
      return;
    }
    clearSensitive();
    changeScreen('login');
    setMessage(t('فرم ثبت‌نام بررسی شد؛ در این پیش‌نمایش حساب واقعی ساخته نمی‌شود.'));
  }
  function reset(e: FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) {
      setError(t('ایمیل یا شماره موبایل را وارد کنید.'));
      return;
    }
    setMessage(t('این مسیر پیش‌نمایش بازیابی است؛ هیچ پیام یا لینکی ارسال نشد.'));
    setIdentifier('');
    setError('');
  }
  const menu = [
    ['overview', 'نمای کلی', UserRound],
    ['orders', 'سفارش‌های من', Package],
    ['addresses', 'نشانی‌ها', MapPin],
    ...(chequeEnabled ? [['credit', 'خرید چکی', CreditCard] as const] : []),
  ] as const;
  const input = (name: keyof typeof registration, label: string, type = 'text') => (
    <div className="field" key={name}>
      <label htmlFor={`register-${name}`}>{t(label)}</label>
      <input
        id={`register-${name}`}
        type={type}
        autoComplete={
          name === 'password' || name === 'confirm'
            ? 'new-password'
            : name === 'email'
              ? 'email'
              : name === 'phone'
                ? 'tel'
                : name === 'username'
                  ? 'username'
                  : 'name'
        }
        value={registration[name]}
        onChange={(e) => setRegistration((old) => ({ ...old, [name]: e.target.value }))}
      />
    </div>
  );
  return (
    <div className="container account-page">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/">{t('سایمان')}</Link>
          <ChevronLeft />
          <span>{t('حساب کاربری')}</span>
        </div>
      </div>
      {screen !== 'account' ? (
        <section className="account-login">
          <div className="login-story">
            <span className="eyebrow">{t('انتخاب‌هایت، یک‌جا.')}</span>
            <h1>
              {t('به دنیای خودت')}
              <br />
              {t('در سایمان خوش آمدی.')}
            </h1>
            <p>{t('سفارش‌ها، علاقه‌مندی‌ها و همراه‌های دیجیتال تو، کنار هم.')}</p>
            <div>
              <ShieldCheck />
              <span>{t('این مرحله پیش‌نمایش ورود است؛ پیامکی ارسال نمی‌شود.')}</span>
            </div>
            <span className="login-spark" aria-hidden="true">
              ✳
            </span>
          </div>
          <div className="login-form card-panel">
            <div className="login-icon">
              {screen === 'otp' || method === 'otp' ? (
                <Smartphone size={25} />
              ) : (
                <KeyRound size={25} />
              )}
            </div>
            <span className="sample-label">{t('ورود آزمایشی')}</span>
            <h2>
              {t(
                screen === 'register'
                  ? 'ساخت حساب کاربری'
                  : screen === 'reset'
                    ? 'بازیابی دسترسی'
                    : screen === 'otp'
                      ? 'کد نمایشی را وارد کنید'
                      : 'به سایمان خوش آمدید',
              )}
            </h2>
            {screen === 'login' && (
              <>
                <div
                  className="auth-tabs"
                  role="tablist"
                  tabIndex={-1}
                  aria-label={t('روش ورود')}
                  onKeyDown={groupNavigation}
                >
                  {authSettings.mobileOtp && (
                    <button
                      role="tab"
                      id="auth-tab-otp"
                      aria-controls="auth-panel"
                      aria-selected={method === 'otp'}
                      tabIndex={method === 'otp' ? 0 : -1}
                      onClick={() => {
                        setMethod('otp');
                        setError('');
                        setPassword('');
                      }}
                    >
                      <Smartphone size={16} />
                      {t('شماره موبایل و کد')}
                    </button>
                  )}
                  {passwordEnabled && (
                    <button
                      role="tab"
                      id="auth-tab-password"
                      aria-controls="auth-panel"
                      aria-selected={method === 'password'}
                      tabIndex={method === 'password' ? 0 : -1}
                      onClick={() => {
                        setMethod('password');
                        setError('');
                      }}
                    >
                      <KeyRound size={16} />
                      {t('ایمیل یا نام کاربری')}
                    </button>
                  )}
                </div>
                {!authSettings.mobileOtp && !passwordEnabled ? (
                  <div className="notice">{t('در حال حاضر هیچ روش ورودی فعال نیست.')}</div>
                ) : (
                  <form
                    onSubmit={login}
                    id="auth-panel"
                    role="tabpanel"
                    aria-labelledby={`auth-tab-${method}`}
                  >
                    <div className="field">
                      <label htmlFor="login-identifier">
                        {t(
                          method === 'otp'
                            ? 'شمارهٔ موبایل آزمایشی'
                            : authSettings.emailPassword && authSettings.usernamePassword
                              ? 'ایمیل یا نام کاربری'
                              : authSettings.emailPassword
                                ? 'ایمیل'
                                : 'نام کاربری',
                        )}
                      </label>
                      <input
                        id="login-identifier"
                        autoComplete={method === 'otp' ? 'tel' : 'username'}
                        inputMode={method === 'otp' ? 'tel' : 'text'}
                        value={identifier}
                        onChange={(e) => {
                          setIdentifier(e.target.value);
                          setError('');
                        }}
                        placeholder={
                          method === 'otp'
                            ? t('۰۹۱۲۳۴۵۶۷۸۹')
                            : authSettings.emailPassword
                              ? 'demo@sayman.local'
                              : 'demo'
                        }
                        aria-invalid={!!error}
                      />
                    </div>
                    {method === 'password' && (
                      <>
                        <div className="field auth-password">
                          <label htmlFor="login-password">{t('رمز عبور')}</label>
                          <div>
                            <input
                              id="login-password"
                              type={showPassword ? 'text' : 'password'}
                              autoComplete="current-password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              aria-invalid={!!error}
                            />
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={t(showPassword ? 'پنهان کردن رمز' : 'نمایش رمز')}
                              onClick={() => setShowPassword((v) => !v)}
                            >
                              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                            </button>
                          </div>
                        </div>
                        <p className="auth-demo-credentials">
                          {t('حساب عمومی پیش‌نمایش:')} <bdi>demo / SaymanDemo!2026</bdi>
                        </p>
                      </>
                    )}
                    <Button type="submit" className="full">
                      {t('ادامهٔ ورود آزمایشی')}
                      <ArrowLeft size={17} />
                    </Button>
                  </form>
                )}
                <div className="auth-secondary-links">
                  {authSettings.registration && (
                    <button onClick={() => changeScreen('register')}>
                      {t('ساخت حساب کاربری')}
                    </button>
                  )}
                  {authSettings.passwordReset && (
                    <button onClick={() => changeScreen('reset')}>
                      {t('رمز را فراموش کرده‌ام')}
                    </button>
                  )}
                </div>
              </>
            )}
            {screen === 'otp' && (
              <>
                <p>{t('پیامکی ارسال نشده؛ برای ادامه کد ۱۲۳۴۵۶ را وارد کنید.')}</p>
                <form onSubmit={verify}>
                  <div className="field">
                    <label htmlFor="demo-code">{t('کد نمایشی ۶ رقمی')}</label>
                    <input
                      id="demo-code"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value);
                        setError('');
                      }}
                      placeholder={t('۱۲۳۴۵۶')}
                      aria-invalid={!!error}
                    />
                  </div>
                  <Button type="submit" className="full">
                    {t('مشاهدهٔ حساب نمونه')}
                    <ArrowLeft size={17} />
                  </Button>
                </form>
                <button className="text-button" onClick={() => changeScreen('login')}>
                  <ArrowRight size={13} />
                  {t('ویرایش شمارهٔ آزمایشی')}
                </button>
              </>
            )}
            {screen === 'register' && (
              <form onSubmit={register} noValidate>
                <div className="form-grid">
                  {input('name', 'نام و نام خانوادگی')}
                  {input('username', 'نام کاربری')}
                  {input('email', 'ایمیل', 'email')}
                  {input('phone', 'شمارهٔ موبایل')}
                  {input('password', 'رمز عبور', 'password')}
                  {input('confirm', 'تکرار رمز عبور', 'password')}
                </div>
                <p className="small-note">
                  {t('نام کاربری ۳ تا ۳۲ حرف لاتین، عدد، نقطه، خط تیره یا زیرخط است.')}
                </p>
                <Button type="submit" className="full">
                  {t('بررسی فرم ثبت‌نام')}
                  <ArrowLeft size={17} />
                </Button>
                <button type="button" className="text-button" onClick={() => changeScreen('login')}>
                  {t('برگشت به ورود')}
                </button>
              </form>
            )}
            {screen === 'reset' && (
              <form onSubmit={reset}>
                <p className="small-note">
                  {t('در نسخهٔ متصل، بازیابی فقط از طریق شماره یا ایمیل تأییدشده انجام می‌شود.')}
                </p>
                <div className="field">
                  <label htmlFor="reset-identifier">{t('ایمیل یا شماره موبایل')}</label>
                  <input
                    id="reset-identifier"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    autoComplete="username"
                  />
                </div>
                <Button type="submit" className="full">
                  {t('بررسی مسیر بازیابی')}
                  <ArrowLeft size={17} />
                </Button>
                <button type="button" className="text-button" onClick={() => changeScreen('login')}>
                  {t('برگشت به ورود')}
                </button>
              </form>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="notice auth-message" role="status">
                {message}
              </p>
            )}
            <p className="small-note">
              {t(
                'ورود واقعی و احراز هویت پس از اتصال سرویس‌ها فعال می‌شود. شمارهٔ این فرم ذخیره یا ارسال نمی‌شود.',
              )}
            </p>
          </div>
        </section>
      ) : (
        <div className="account-layout">
          <aside className="account-sidebar card-panel">
            <div className="account-avatar">
              <UserRound size={25} />
            </div>
            <h2>{t('همراه آزمایشی سایمان')}</h2>
            <p>{t('حساب نمایشی · بدون ورود واقعی')}</p>
            <nav>
              {menu.map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={activeTab === id ? 'active' : ''}
                  onClick={() => setTab(id)}
                >
                  <Icon size={18} />
                  {t(label)}
                  <ChevronLeft size={13} />
                </button>
              ))}
              <Link href="/wishlist">
                <Heart size={18} />
                {t('علاقه‌مندی‌ها')}
                <ChevronLeft size={13} />
              </Link>
              <Link href="/support">
                <MessageCircle size={18} />
                {t('راهنما و پشتیبانی')}
                <ChevronLeft size={13} />
              </Link>
              <button onClick={() => changeScreen('login')}>
                <LogOut size={18} />
                {t('خروج از پیش‌نمایش')}
              </button>
            </nav>
          </aside>
          <section className="card-panel account-main">
            {activeTab === 'overview' ? (
              <>
                <span className="eyebrow">{t('خوش برگشتی')}</span>
                <h1>{t('همه‌چیز برای انتخاب بعدی‌ات آماده است.')}</h1>
                <div className="account-stat-grid">
                  <div>
                    <Package />
                    <strong>{digits(0)}</strong>
                    <span>{t('سفارش ثبت‌شده')}</span>
                  </div>
                  <Link href="/wishlist">
                    <Heart />
                    <strong>{digits(wishlist.length)}</strong>
                    <span>{t('انتخاب ذخیره‌شده')}</span>
                  </Link>
                  {chequeEnabled && (
                    <Link href="/installments">
                      <CreditCard />
                      <strong>{t('چکی')}</strong>
                      <span>{t('راهنمای خرید')}</span>
                    </Link>
                  )}
                </div>
                <div className="notice">
                  {t(
                    'این حساب، نمونهٔ نمایشی است. هیچ هویت، سفارش، نشانی یا پروندهٔ اعتباری واقعی ایجاد نشده است.',
                  )}
                </div>
                <Button asChild variant="outline">
                  <Link href="/catalog">
                    {t('انتخاب بعدی من')}
                    <ArrowLeft size={16} />
                  </Link>
                </Button>
              </>
            ) : (
              <div className="empty-state">
                {activeTab === 'orders' ? (
                  <Package size={45} />
                ) : activeTab === 'addresses' ? (
                  <MapPin size={45} />
                ) : (
                  <CreditCard size={45} />
                )}
                <h2>
                  {t(
                    activeTab === 'orders'
                      ? 'هنوز سفارشی ثبت نشده'
                      : activeTab === 'addresses'
                        ? 'نشانی‌ها بعد از اتصال حساب'
                        : 'اول، شرایط خرید چکی را ببین',
                  )}
                </h2>
                <p>
                  {t(
                    activeTab === 'orders'
                      ? 'این پیش‌نمایش سفارشی ثبت نمی‌کند. در نسخهٔ متصل، وضعیت سفارش و ارسال همین‌جا نمایش داده می‌شود.'
                      : activeTab === 'addresses'
                        ? 'ذخیره و مدیریت نشانی پس از راه‌اندازی حساب واقعی فعال می‌شود.'
                        : 'درخواست اعتبار و مدارک فقط در نسخهٔ متصل و پس از تأیید شرایط دریافت می‌شوند.',
                  )}
                </p>
                <Button asChild variant="outline">
                  <Link href={activeTab === 'credit' ? '/installments' : '/catalog'}>
                    {t(activeTab === 'credit' ? 'محاسبه و شرایط' : 'کشف محصولات')}
                    <ArrowLeft size={16} />
                  </Link>
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
