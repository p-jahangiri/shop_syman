'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Minus, Trash2, ClipboardList, Info, ArrowLeft } from 'lucide-react';
import Link, { useRouter } from './localized-link';
import Image from './content-image';
import { useI18n } from './locale-provider';
import { useCustomerSession } from './auth-provider';
import { useSourcing, useSourcingCommand } from './sourcing-provider';
import { useShop } from './shop-context';
import { Button } from './ui';
import { CartError } from '@/lib/cart-client';
import { submitSourcing } from '@/lib/sourcing-client';
import {
  startSourcingJournal,
  finishSourcingJournal,
  markSourcingUncertain,
  failSourcingJournal,
  sourcingJournalTarget,
  isCartSourcingCommand,
} from '@/lib/sourcing-journal';
import {
  sourcingSubmitSchema,
  sourcingAttributeText,
  type SourcingModel,
  type SourcingCandidate,
} from '@/lib/sourcing-contract';
import type { PhoneConfigurationSnapshot } from '@/lib/phone-discovery-contract';
import type { MarketItem } from '@/lib/market-contract';
import './sourcing.css';
export function useSourcingText() {
  const { locale } = useI18n();
  return (fa: string, en: string) => (locale === 'fa' ? fa : en);
}
export function SourcingError({ code, unknown = false }: { code: string; unknown?: boolean }) {
  const text = useSourcingText();
  const message = unknown
    ? text(
        'نتیجهٔ ذخیره دریافت نشد؛ پیش از تغییر دوباره، اطلاعات سبد را از سرور بازخوانی کنید.',
        'The save result was not received. Refresh the server cart before making another change.',
      )
    : code === 'phone_configuration_required'
      ? text(
          'رنگ، رم و حافظهٔ این گوشی را انتخاب کنید تا درخواست دقیق ثبت شود.',
          'Choose this phone’s colour, RAM and storage before submitting your request.',
        )
      : code.includes('now_in_store')
        ? text(
            'این مدل اکنون پیشنهاد موجود در فروشگاه دارد؛ آن را از فهرست فروشگاه بررسی کنید.',
            'This model now has an available store offer. Review it in the store catalogue.',
          )
        : code.includes('limit')
          ? text(
              'تعداد یا ظرفیت انتخاب‌ها از حد مجاز بیشتر است؛ انتخاب قبلی حفظ شده است.',
              'The quantity or selection capacity was exceeded. Previous selections were preserved.',
            )
          : code.includes('conflict') || code === 'version_conflict'
            ? text(
                'سبد یا مشخصات منبع تغییر کرده است؛ اطلاعات تازه را بررسی کنید.',
                'The cart or source details changed. Review the refreshed information.',
              )
            : code === 'invalid_credentials'
              ? text('برای ادامه دوباره وارد حساب شوید.', 'Sign in again to continue.')
              : code.includes('unavailable')
                ? text(
                    'این انتخاب یا سرویس در دسترس نیست؛ اطلاعات را بازخوانی کنید.',
                    'The selection or service is unavailable. Refresh its information.',
                  )
                : text(
                    'ذخیره یا دریافت اطلاعات انجام نشد؛ دوباره بررسی کنید.',
                    'Information could not be saved or loaded. Please check again.',
                  );
  return (
    <p role="alert" className="notice sourcing-error">
      {message}
    </p>
  );
}
export function MarketSelection({ item }: { item: MarketItem }) {
  const context = useSourcing(),
    text = useSourcingText(),
    { digits } = useI18n(),
    [quantity, setQuantity] = useState(1),
    [added, setAdded] = useState(false);
  const selected = context?.cart?.lines.find((line) => line.listingId === item.id)?.quantity ?? 0;
  if (!context)
    return (
      <p className="small-note">
        {text(
          'درخواست تأمین در حالت پیش‌نمایش فعال نیست.',
          'Supply requests are unavailable in preview mode.',
        )}
      </p>
    );
  return (
    <div className="sourcing-selection">
      <p>
        {text(
          'این انتخاب فقط برای استعلام و درخواست تأمین است؛ سفارش فروش، رزرو یا پرداخت ایجاد نمی‌کند.',
          'This selection is only for an enquiry and supply request. It creates no sales order, reservation or payment.',
        )}
      </p>
      <label htmlFor={`sourcing-quantity-${item.id}`}>
        {text('تعداد درخواستی', 'Requested quantity')}
      </label>
      <input
        id={`sourcing-quantity-${item.id}`}
        type="number"
        min={1}
        max={1000000}
        value={quantity}
        disabled={context.busy || context.locked || context.unknown}
        onChange={(event) => {
          setAdded(false);
          setQuantity(event.target.value === '' ? 0 : Number(event.target.value));
        }}
      />
      <Button
        className="full"
        disabled={
          !context.ready ||
          context.busy ||
          context.locked ||
          context.unknown ||
          !Number.isSafeInteger(quantity) ||
          quantity < 1 ||
          quantity > 1000000
        }
        onClick={() => void context.add(item.id, quantity).then((success) => setAdded(success))}
      >
        {context.busy
          ? text('در حال ذخیره…', 'Saving…')
          : text('انتخاب برای درخواست تأمین', 'Select for a supply request')}
        <Plus size={17} />
      </Button>
      {(added || selected > 0) && (
        <p role="status">
          {text('تعداد انتخاب‌شده در سبد:', 'Selected in cart:')} {digits(selected)}{' '}
          <Link href="/cart#sourcing">
            {text('دیدن و ثبت درخواست', 'Review and submit request')}
          </Link>
        </p>
      )}
      {context.error && <SourcingError code={context.error} unknown={context.unknown} />}
      <div className="order-action-row">
        <Link href="/cart#sourcing" className="text-link">
          {text('بخش تأمین سبد', 'Supply selections in cart')}
        </Link>
        {(context.error || !context.ready) && (
          <button type="button" className="text-link" onClick={context.refresh}>
            {text('بازخوانی وضعیت سبد', 'Refresh cart state')}
          </button>
        )}
      </div>
    </div>
  );
}
export function SourcingModelView({
  model,
  quantity,
  configuration,
}: {
  model: SourcingModel;
  quantity: number;
  configuration?: PhoneConfigurationSnapshot;
}) {
  const { locale, digits } = useI18n(),
    text = useSourcingText(),
    name = locale === 'fa' ? model.nameFa : model.nameEn;
  return (
    <div className="sourcing-model">
      <Image src={configuration?.imageUrl ?? model.images[0]} alt={name} width={100} height={90} />
      <div>
        <h3>{name}</h3>
        <p>
          {model.brand} · {locale === 'fa' ? model.categoryNameFa : model.categoryNameEn}
        </p>
        {configuration && (
          <p className="sourcing-configuration">
            {locale === 'fa' ? configuration.colorNameFa : configuration.colorNameEn} ·{' '}
            {text('رم', 'RAM')} {digits(configuration.ramGb)} GB · {digits(configuration.storageGb)}{' '}
            GB
          </p>
        )}
        <small>
          {text('تعداد', 'Quantity')}: {digits(quantity)}
        </small>
        <details>
          <summary>{text('مشخصات ثبت‌شدهٔ مدل', 'Recorded model specifications')}</summary>
          <p className="preserve-lines">
            {locale === 'fa' ? model.descriptionFa : model.descriptionEn}
          </p>
          <dl className="sourcing-specs">
            {model.attributes.map((attribute) => (
              <div key={attribute.attributeId}>
                <dt>{locale === 'fa' ? attribute.labelFa : attribute.labelEn}</dt>
                <dd>{sourcingAttributeText(attribute, locale)}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </div>
  );
}
export function SourcingSource({
  source,
  historical = false,
}: {
  source: Pick<
    SourcingCandidate,
    | 'sourceNameFa'
    | 'sourceNameEn'
    | 'sourceUrl'
    | 'availability'
    | 'observedAt'
    | 'validUntil'
    | 'referencePriceRial'
    | 'referencePriceCurrent'
    | 'isDemo'
  >;
  historical?: boolean;
}) {
  const text = useSourcingText();
  void historical;
  return (
    <div className="sourcing-source">
      {source.isDemo && (
        <strong className="market-demo-label">
          {text('نمونهٔ توسعه؛ موجودی فروشگاه نیست', 'Development sample; not store inventory')}
        </strong>
      )}
      <p>
        {text(
          'در انتظار بررسی و اعلام قیمت و شرایط فروشگاه؛ ثبت درخواست یا پذیرش پیشنهاد پرداختی ایجاد نمی‌کند.',
          'Awaiting the store’s price and terms. Submitting a request or accepting a quote does not create a payment.',
        )}
      </p>
    </div>
  );
}
export function FrozenSourcingNotice() {
  const { pending } = useSourcingCommand(),
    text = useSourcingText();
  if (!pending || pending.result || isCartSourcingCommand(pending.command)) return null;
  return (
    <div className="notice" role="status">
      <p>
        {text(
          'نتیجهٔ فرمان تأمین هنوز دریافت نشده است. شناسهٔ پیگیری را نگه دارید و همان فرمان را پیگیری کنید.',
          'A supply command has not been confirmed yet. Keep this tracking ID and follow the same command.',
        )}
      </p>
      <span>{text('شناسهٔ پیگیری:', 'Tracking ID:')}</span>{' '}
      <code dir="ltr">{pending.command.body.requestId}</code>
      <Link
        className="text-link"
        href={
          pending.command.kind === 'submit' ? '/cart#sourcing' : `/sourcing/${pending.command.id}`
        }
      >
        {text('پیگیری همین درخواست', 'Track this request')}
      </Link>
    </div>
  );
}
export function SourcingDrawerLink({ onNavigate }: { onNavigate: () => void }) {
  const context = useSourcing(),
    text = useSourcingText(),
    { digits } = useI18n();
  if (!context?.cart?.lines.length) return null;
  return (
    <div className="notice sourcing-drawer-link">
      <p>
        {digits(context.cart.lines.reduce((sum, line) => sum + line.quantity, 0))}{' '}
        {text(
          'انتخاب برای درخواست تأمین؛ خارج از مبلغ خرید',
          'supply request selections; excluded from purchase amounts',
        )}
      </p>
      <Link href="/cart#sourcing" className="text-link" onClick={onNavigate}>
        {text('دیدن و ثبت درخواست تأمین', 'Review and submit supply selections')}
      </Link>
    </div>
  );
}
export function SourcingCartIndicator() {
  const context = useSourcing();
  return context?.cart?.lines.length ? (
    <i className="sourcing-cart-indicator" aria-hidden="true" />
  ) : null;
}
export function SourcingCartSection() {
  const context = useSourcing(),
    auth = useCustomerSession(),
    shop = useShop(),
    text = useSourcingText(),
    { locale, digits } = useI18n(),
    router = useRouter(),
    journal = useSourcingCommand();
  const [note, setNote] = useState(''),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState('');
  const mounted = useRef(true),
    sending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const owner = journal.owner,
    pending = journal.pending,
    resultTarget = pending?.result ? sourcingJournalTarget(pending) : null,
    command = pending?.command.kind === 'submit' && !pending.result ? pending.command : null;
  useEffect(() => {
    setNote('');
    setAck(false);
    setFailure('');
  }, [owner]);
  if (!context) return null;
  const cart = context.cart;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!owner || busy || sending.current) return;
    let frozen = command;
    if (frozen) markSourcingUncertain(owner, frozen.body.requestId);
    if (!frozen) {
      if (
        !cart?.version ||
        !cart.lines.length ||
        cart.hasIssues ||
        !ack ||
        context?.busy ||
        context?.unknown ||
        context?.locked
      )
        return;
      const parsed = sourcingSubmitSchema.safeParse({
        requestId: crypto.randomUUID(),
        cartVersion: cart.version,
        expected: cart.lines.map((line) => ({
          listingId: line.listingId,
          fingerprint: line.candidate.fingerprint,
        })),
        note,
      });
      if (!parsed.success) {
        setFailure('invalid_sourcing_input');
        return;
      }
      frozen = { kind: 'submit', locale, body: parsed.data };
      try {
        startSourcingJournal(owner, frozen);
      } catch {
        return;
      }
    }
    sending.current = true;
    setBusy(true);
    setFailure('');
    const original = frozen;
    try {
      const result = await submitSourcing(auth.store.fetch, original.locale, original.body);
      if (
        !finishSourcingJournal(owner, original.body.requestId, result) ||
        !mounted.current ||
        auth.store.snapshot().session?.user.id !== owner
      )
        return;
      setNote('');
      context?.refresh();
      shop.retry();
      router.push(`/sourcing/${result.id}`);
    } catch (error) {
      const outcome = failSourcingJournal(
        owner,
        original.body.requestId,
        error instanceof CartError ? error.status : 0,
      );
      if (
        outcome === 'ignored' ||
        !mounted.current ||
        auth.store.snapshot().session?.user.id !== owner
      )
        return;
      if (outcome === 'rejected') {
        setFailure(error instanceof CartError ? error.code : 'invalid_sourcing_input');
        context?.refresh();
      } else setFailure('unknown');
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section id="sourcing" className="card-panel sourcing-cart">
      <div className="sourcing-heading">
        <h2>
          <ClipboardList size={22} />
          {text('انتخاب‌های درخواست تأمین', 'Supply request selections')}
        </h2>
        <button
          type="button"
          className="text-link"
          disabled={context.busy || busy}
          onClick={context.refresh}
        >
          {text('بازخوانی سبد', 'Refresh cart')}
        </button>
      </div>
      <p className="notice">
        <Info size={17} />
        {text(
          'این بخش در مبلغ سبد خرید جمع نمی‌شود. ثبت درخواست فقط بررسی امکان تأمین را آغاز می‌کند؛ خرید، رزرو و پرداخت نیست.',
          'This section is excluded from shopping cart totals. Submission only starts a supply enquiry; it is not a purchase, reservation or payment.',
        )}
      </p>
      {context.error && <SourcingError code={context.error} unknown={context.unknown} />}
      {!context.ready ? (
        <p role="status">
          {text('در حال بازیابی انتخاب‌های تأمین…', 'Loading supply selections…')}
        </p>
      ) : cart?.lines.length ? (
        cart.lines.map((line) => (
          <article className="sourcing-cart-line" key={line.listingId}>
            {line.candidate.model ? (
              <SourcingModelView
                model={line.candidate.model}
                quantity={line.quantity}
                configuration={line.candidate.configuration}
              />
            ) : (
              <div>
                <h3>{text('مدل دیگر عمومی نیست', 'This model is no longer public')}</h3>
                <code dir="ltr">{line.listingId}</code>
              </div>
            )}
            <SourcingSource source={line.candidate} />
            {line.candidate.issue && (
              <div className="notice">
                <p>
                  {line.candidate.issue === 'phone_configuration_required'
                    ? text(
                        'برای این گوشی هنوز رنگ، رم و حافظه انتخاب نشده است. ترکیب دقیق را از صفحه مدل انتخاب کنید.',
                        'This phone needs an exact colour, RAM and storage choice. Select it on the model page.',
                      )
                    : line.candidate.issue === 'now_in_store'
                      ? text(
                          'این مدل اکنون در فروشگاه قابل خرید است؛ درخواست تازه برای آن ثبت نمی‌شود.',
                          'This model now has an available store offer and cannot be submitted as a supply request.',
                        )
                      : text(
                          'اطلاعات عمومی این مدل در دسترس نیست. می‌توانید تعداد را کاهش دهید یا آن را حذف کنید.',
                          'Public details for this model are unavailable. You can reduce its quantity or remove it.',
                        )}
                </p>
                {line.candidate.issue === 'phone_configuration_required' && (
                  <Link className="text-link" href={'/market/' + line.listingId}>
                    {text('انتخاب رنگ و حافظه', 'Choose colour and memory')}
                  </Link>
                )}
                {line.candidate.issue === 'now_in_store' && line.candidate.model && (
                  <Link className="text-link" href={`/product/${line.candidate.model.slug}`}>
                    {text('بررسی پیشنهاد فروشگاه', 'Review store offer')}
                  </Link>
                )}
              </div>
            )}
            <div className="sourcing-line-actions">
              <Button
                variant="outline"
                disabled={context.busy || context.locked || context.unknown || line.quantity <= 1}
                aria-label={text('کاهش تعداد', 'Decrease quantity')}
                onClick={() => void context.quantity(line.listingId, line.quantity - 1)}
              >
                <Minus size={15} />
              </Button>
              <span>{digits(line.quantity)}</span>
              <Button
                variant="outline"
                disabled={
                  context.busy ||
                  context.locked ||
                  context.unknown ||
                  line.quantity >= 1000000 ||
                  !!line.candidate.issue
                }
                aria-label={text('افزایش تعداد', 'Increase quantity')}
                onClick={() => void context.quantity(line.listingId, line.quantity + 1)}
              >
                <Plus size={15} />
              </Button>
              <button
                type="button"
                className="text-link"
                disabled={context.busy || context.locked || context.unknown}
                onClick={() => void context.quantity(line.listingId, 0)}
              >
                <Trash2 size={16} />
                {text('حذف انتخاب', 'Remove selection')}
              </button>
            </div>
          </article>
        ))
      ) : (
        <p>
          {text(
            'هنوز مدلی برای درخواست تأمین انتخاب نکرده‌اید.',
            'No models selected for a supply request yet.',
          )}
        </p>
      )}
      <FrozenSourcingNotice />
      {pending?.result && (
        <p role="status">
          {text(
            'نتیجهٔ درخواست قبلی مشخص شد. وضعیت فعلی را در صفحهٔ درخواست ببینید.',
            'The previous request result is available. Open its page for the current status.',
          )}{' '}
          {resultTarget && (
            <Link href={`/sourcing/${resultTarget.id}`}>{resultTarget.reference}</Link>
          )}
        </p>
      )}
      {owner && (cart?.lines.length || command) ? (
        <form onSubmit={submit}>
          <fieldset disabled={busy || !!command || context.locked} className="order-fieldset">
            <div className="field">
              <label htmlFor="sourcing-note">
                {text(
                  'خواسته یا توضیح شما (اختیاری، حداکثر ۵۰۰ نویسه)',
                  'Your requirements or note (optional, up to 500 characters)',
                )}
              </label>
              <textarea
                id="sourcing-note"
                value={command?.body.note ?? note}
                maxLength={500}
                rows={3}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={command ? true : ack}
                onChange={(event) => setAck(event.target.checked)}
              />
              <span>
                {text(
                  'می‌دانم قیمت/پیکربندی و امکان تأمین باید بعداً بررسی شوند؛ درخواستم خرید قطعی نیست.',
                  'I understand that configuration, price and supply must be checked later; this request is not a confirmed purchase.',
                )}
              </span>
            </label>
          </fieldset>
          {failure &&
            (failure === 'unknown' ? (
              <p className="notice" role="alert">
                {text(
                  'نتیجه دریافت نشد. با تلاش دوباره، همین درخواست پیگیری می‌شود. می‌توانید فهرست درخواست‌های خود را هم بررسی کنید.',
                  'No result was received. Retry follows the same request. You can also check your request list.',
                )}
              </p>
            ) : (
              <SourcingError code={failure} />
            ))}
          <Button
            type="submit"
            disabled={
              busy ||
              context.busy ||
              (!command &&
                (!ack || !cart?.version || cart.hasIssues || context.unknown || context.locked))
            }
          >
            {busy
              ? text('در حال ثبت…', 'Submitting…')
              : command
                ? text('پیگیری و تلاش دوباره', 'Check and retry')
                : text('ثبت درخواست بررسی تأمین', 'Submit supply enquiry')}
          </Button>
        </form>
      ) : !owner && cart?.lines.length ? (
        <p>
          <Link className="button button-primary" href="/account?returnTo=/cart">
            {text('ورود و ثبت درخواست تأمین', 'Sign in and submit a supply request')}
          </Link>
        </p>
      ) : null}
      <div className="order-action-row">
        <Link href="/market" className="text-link">
          {text('ادامهٔ کشف مدل‌های بازار', 'Explore more market models')}
          <ArrowLeft size={16} />
        </Link>
        <Link href="/sourcing" className="text-link">
          {text('درخواست‌های تأمین من', 'My supply requests')}
        </Link>
      </div>
    </section>
  );
}
