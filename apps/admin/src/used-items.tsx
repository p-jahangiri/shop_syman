import { AdminFilterForm } from './admin-filters';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, save, ApiError } from './api';
import { Busy, ErrorBox, Field } from './ui';
import {
  usedChoices,
  usedDetail,
  usedInput,
  usedResult,
  type UsedDetail,
} from './used-items-contract';
import type { UsedCondition } from '../../storefront/lib/used-condition-contract';
import { UsedConditionReport } from '../../storefront/components/used-condition';
import { adminViewRevision } from './admin-view-authority';
type Command = { id: string; input: ReturnType<typeof usedInput.parse> };
const names = {
  unknown: 'نامشخص',
  passed: 'سالم در بررسی فنی',
  needsRepair: 'نیازمند تعمیر',
  notApplicable: 'فاقد این ویژگی',
  measured: 'درصد اندازه‌گیری‌شده',
  intact: 'بدون آسیب مشاهده‌شده',
  worn: 'آثار استفاده',
  damaged: 'آسیب‌دیده',
  noKnownRepair: 'تعمیر شناخته‌شده ندارد',
  repaired: 'تعمیر شده',
};
export function UsedItemsPage({ writable, viewerId }: { writable: boolean; viewerId: string }) {
  const [text, setText] = useState(''),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState(''),
    [revision, setRevision] = useState(0);
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['admin', 'used-choices', viewerId, query],
    queryFn: async () =>
      usedChoices.parse(await api('/admin/used-items/variants?query=' + encodeURIComponent(query))),
  });
  const detail = useQuery({
    queryKey: ['admin', 'used-detail', viewerId, selected],
    enabled: !!selected,
    queryFn: async () => {
      const value = usedDetail.parse(
        await api('/admin/used-items/' + encodeURIComponent(selected)),
      );
      if (value.variantId.toUpperCase() !== selected.toUpperCase())
        throw new Error('پاسخ مربوط به دستگاه انتخابی نیست.');
      return value;
    },
  });
  return (
    <section className="panel">
      <h2>کالای کارکرده و گزارش سلامت</h2>
      <p className="notice">
        ابتدا برای هر دستگاه، یک تنوع و SKU مستقل بسازید. ثبت گزارش، مانده را تغییر نمی‌دهد و فقط
        برای موجودی حداکثر یک دستگاه و بدون رزرو فعال مجاز است. این SKU پس از ثبت گزارش، سابقهٔ
        کارکرده خواهد داشت. یادداشت‌ها عمومی‌اند؛ شمارهٔ سریال یا اطلاعات خصوصی وارد نکنید.
      </p>
      <AdminFilterForm
        onSubmit={(e) => {
          e.preventDefault();
          setSelected('');
          setQuery(text.trim());
        }}
        label="جست‌وجوی دستگاه کارکرده"
        search={
          <Field label="جست‌وجوی SKU یا نام تنوع">
            <input maxLength={100} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        }
        actions={<button>جست‌وجوی دستگاه</button>}
        applied={query ? ['جست‌وجو: ' + query] : []}
      ></AdminFilterForm>
      <ErrorBox error={list.error} />
      {list.isPending ? (
        <Busy />
      ) : (
        <>
          <Field label="دستگاه">
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">انتخاب دستگاه…</option>
              {list.data?.items.map((i) => (
                <option key={i.variantId} value={i.variantId}>
                  {i.sku} · {i.labelFa}
                  {i.used ? ' · کارکرده' : ''}
                </option>
              ))}
            </select>
          </Field>
          {list.data?.hasMore && (
            <p className="notice">
              ۵۰ نتیجهٔ نخست نمایش داده شده؛ برای یافتن دستگاه، جست‌وجو را دقیق‌تر کنید.
            </p>
          )}
        </>
      )}
      <ErrorBox error={detail.error} />
      {selected && detail.isPending && <Busy />}
      {selected && detail.data && (
        <InspectionEditor
          key={`${viewerId}:${detail.data.variantId}:${detail.data.variantVersion}:${revision}`}
          detail={detail.data}
          writable={writable}
          onSaved={() => {
            void detail.refetch().then(() => setRevision((v) => v + 1));
            void client.invalidateQueries({ queryKey: ['admin', 'used-choices'] });
          }}
        />
      )}
    </section>
  );
}
function InspectionEditor({
  detail,
  writable,
  onSaved,
}: {
  detail: UsedDetail;
  writable: boolean;
  onSaved: () => void;
}) {
  const [facts, setFacts] = useState<UsedCondition>(
    detail.inspection ?? {
      inspectionId: crypto.randomUUID().replaceAll('-', ''),
      technicalState: 'unknown',
      batteryState: 'unknown',
      batteryHealthPercent: null,
      screenState: 'unknown',
      bodyState: 'unknown',
      repairState: 'unknown',
      notesFa: '',
      notesEn: '',
      inspectedAt: new Date().toISOString(),
    },
  );
  const [percent, setPercent] = useState(
    facts.batteryHealthPercent === null ? '' : String(facts.batteryHealthPercent),
  );
  const [inspected, setInspected] = useState(facts.inspectedAt.slice(0, 16));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [uncertain, setUncertain] = useState(false),
    [blocked, setBlocked] = useState(false);
  const pending = useRef<Command | null>(null);
  async function run(command: Command) {
    if (busy) return;
    const authority = adminViewRevision();
    pending.current = command;
    setBusy(true);
    setError(null);
    try {
      const result = usedResult.parse(
        await save(
          '/admin/used-items/' + encodeURIComponent(detail.variantId) + '/commands/' + command.id,
          command.input,
          'PUT',
        ),
      );
      if (adminViewRevision() !== authority) return;
      if (
        result.detail.variantId.toUpperCase() !== detail.variantId.toUpperCase() ||
        result.detail.inspection?.inspectionId !== command.input.inspection.inspectionId
      )
        throw new Error('پاسخ با گزارش ارسالی هم‌خوان نیست.');
      pending.current = null;
      setUncertain(false);
      setBlocked(true);
      onSaved();
    } catch (e) {
      if (adminViewRevision() !== authority) return;
      setError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        pending.current = null;
        setUncertain(false);
        setBlocked(true);
      } else setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  function submit() {
    try {
      if (!inspected) throw new Error('زمان بررسی را مشخص کنید.');
      const input = usedInput.parse({
        variantVersion: detail.variantVersion,
        inspection: {
          ...facts,
          inspectionId: crypto.randomUUID().replaceAll('-', ''),
          inspectedAt: new Date(inspected + ':00Z').toISOString(),
          batteryHealthPercent:
            facts.batteryState === 'measured' && percent !== '' ? Number(percent) : null,
        },
      });
      if (Date.parse(input.inspection.inspectedAt) > Date.now())
        throw new Error('زمان بررسی نمی‌تواند در آینده باشد.');
      void run({ id: crypto.randomUUID().replaceAll('-', ''), input });
    } catch (e) {
      setError(e);
    }
  }
  function select<
    K extends 'technicalState' | 'batteryState' | 'screenState' | 'bodyState' | 'repairState',
  >(key: K, label: string, values: UsedCondition[K][]) {
    return (
      <Field label={label}>
        <select
          value={facts[key]}
          onChange={(e) => setFacts((v) => ({ ...v, [key]: e.target.value }))}
        >
          {values.map((v) => (
            <option key={v} value={v}>
              {names[v]}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <div>
      <h3>
        <bdi>{detail.sku}</bdi>
      </h3>
      <UsedConditionReport condition={detail.inspection ?? undefined} />
      <ErrorBox error={error} />
      {uncertain && (
        <div className="notice" role="status">
          <p>
            نتیجه دریافت نشد. پیگیری، همان شناسه و بدنه را ارسال می‌کند؛ پیش از ویرایش، نتیجه را
            بررسی کنید.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              if (pending.current) void run(pending.current);
            }}
          >
            پیگیری همان ثبت
          </button>
        </div>
      )}
      <button
        disabled={busy}
        onClick={() => {
          pending.current = null;
          setUncertain(false);
          setBlocked(true);
          onSaved();
        }}
      >
        دریافت گزارش و نسخهٔ تازه
      </button>
      <fieldset disabled={!writable || busy || uncertain || blocked}>
        {select('technicalState', 'وضعیت فنی', ['unknown', 'passed', 'needsRepair'])}
        {select('batteryState', 'وضعیت باتری', ['unknown', 'notApplicable', 'measured'])}
        {facts.batteryState === 'measured' && (
          <Field label="سلامت باتری؛ درصد از ۰ تا ۱۰۰">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </Field>
        )}
        {select('screenState', 'وضعیت صفحه', ['unknown', 'intact', 'worn', 'damaged'])}
        {select('bodyState', 'وضعیت بدنه', ['unknown', 'intact', 'worn', 'damaged'])}
        {select('repairState', 'سابقهٔ تعمیر', ['unknown', 'noKnownRepair', 'repaired'])}
        <Field label="زمان بررسی به UTC">
          <input
            type="datetime-local"
            value={inspected}
            onChange={(e) => setInspected(e.target.value)}
          />
        </Field>
        <Field label="یادداشت عمومی فارسی">
          <textarea
            maxLength={2000}
            value={facts.notesFa}
            onChange={(e) => setFacts((v) => ({ ...v, notesFa: e.target.value }))}
          />
        </Field>
        <Field label="Public notes in English">
          <textarea
            dir="ltr"
            maxLength={2000}
            value={facts.notesEn}
            onChange={(e) => setFacts((v) => ({ ...v, notesEn: e.target.value }))}
          />
        </Field>
        <button className="primary" onClick={submit}>
          ثبت نسخهٔ تازهٔ گزارش
        </button>
      </fieldset>
      {!writable && <p className="notice">ثبت گزارش به مجوز ویرایش کاتالوگ و موجودی نیاز دارد.</p>}
    </div>
  );
}
