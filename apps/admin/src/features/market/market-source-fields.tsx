import { Field, Check } from '../../components/ui';
import { Text } from '../../components/forms/forms';
import {
  normalizeMarketDigits,
  type MarketDetails,
} from '../../api/contracts/market/market-contract';
const labels = { Draft: 'پیش‌نویس', Published: 'منتشرشده در بازار', Hidden: 'پنهان از بازار' };
function localDate(value: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return 'invalid-date';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function MarketPublicationField({
  details,
  onChange,
}: {
  details: MarketDetails;
  onChange: (details: MarketDetails) => void;
}) {
  return (
    <Field label="نمایش مدل به مشتری">
      <select
        value={details.status}
        onChange={(e) =>
          onChange({ ...details, status: e.target.value as MarketDetails['status'] })
        }
      >
        {Object.entries(labels).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function MarketSourceFields({
  details,
  onChange,
  lockIdentity = false,
  includePublication = true,
}: {
  details: MarketDetails;
  onChange: (details: MarketDetails) => void;
  lockIdentity?: boolean;
  includePublication?: boolean;
}) {
  return (
    <div className="form-grid">
      {includePublication && <MarketPublicationField details={details} onChange={onChange} />}
      <Text
        label="کلید داخلی منبع"
        disabled={lockIdentity}
        dir="ltr"
        value={details.sourceKey}
        required
        onChange={(sourceKey) => onChange({ ...details, sourceKey })}
      />
      <Text
        label="شناسهٔ داخلی کالا در منبع"
        disabled={lockIdentity}
        dir="ltr"
        value={details.sourceItemKey}
        required
        onChange={(sourceItemKey) => onChange({ ...details, sourceItemKey })}
      />
      <Text
        label="نام فارسی منبع داخلی"
        value={details.sourceNameFa}
        required
        onChange={(sourceNameFa) => onChange({ ...details, sourceNameFa })}
      />
      <Text
        label="English internal source name"
        dir="ltr"
        value={details.sourceNameEn}
        required
        onChange={(sourceNameEn) => onChange({ ...details, sourceNameEn })}
      />
      <Text
        label="پیوند منبع داخلی (اختیاری)"
        dir="ltr"
        value={details.sourceUrl ?? ''}
        onChange={(sourceUrl) => onChange({ ...details, sourceUrl: sourceUrl || null })}
      />
      <Field label="گزارش داخلی تأمین، مستقل از انبار سایمان">
        <select
          value={details.availability}
          onChange={(e) =>
            onChange({ ...details, availability: e.target.value as MarketDetails['availability'] })
          }
        >
          <option value="unknown">نیازمند استعلام</option>
          <option value="available">منبع، موجود گزارش کرده</option>
          <option value="unavailable">منبع، ناموجود گزارش کرده</option>
        </select>
      </Field>
      <Text
        label="زمان مشاهده (زمان محلی شما)"
        type="datetime-local"
        dir="ltr"
        value={localDate(details.observedAt)}
        onChange={(v) =>
          onChange({
            ...details,
            observedAt: v
              ? Number.isFinite(new Date(v).getTime())
                ? new Date(v).toISOString()
                : 'invalid-date'
              : null,
          })
        }
      />
      <Text
        label="پایان اعتبار گزارش داخلی"
        type="datetime-local"
        dir="ltr"
        value={localDate(details.validUntil)}
        onChange={(v) =>
          onChange({
            ...details,
            validUntil: v
              ? Number.isFinite(new Date(v).getTime())
                ? new Date(v).toISOString()
                : 'invalid-date'
              : null,
          })
        }
      />
      <Text
        label="مبلغ مرجع داخلی (ریال، اختیاری؛ قیمت پیشنهادی مشتری نیست)"
        dir="ltr"
        value={details.referencePriceRial ?? ''}
        onChange={(v) =>
          onChange({ ...details, referencePriceRial: v ? normalizeMarketDigits(v) : null })
        }
      />
      <Check
        label="دادهٔ نمونهٔ توسعه؛ موجودی و قیمت واقعی نیست"
        checked={details.isDemo}
        onChange={(e) => onChange({ ...details, isDemo: e.target.checked })}
      />
    </div>
  );
}
