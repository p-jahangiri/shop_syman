import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CircularProgress from '@mui/material/CircularProgress';
import { Tags, X } from 'lucide-react';
import { api } from '../../api/api';
import { ProductVariantsTable } from './product-variants-table';
import { useProductCommand } from '../../hooks/use-product-command';
import {
  draftOfProduct,
  moneyLabel,
  tomanToRial,
  type ProductVariantDraft,
  type ProductFieldErrors,
} from './product-editor-model';
import {
  productWorkspaceBase,
  readWorkspaceDetail,
  readFormFields,
} from '../../api/contracts/catalog/product-workspace-contract';
export function ProductQuickPrices({
  id,
  viewerId,
  onClose,
}: {
  id: string;
  viewerId: string;
  onClose: () => void;
}) {
  const compact = useMediaQuery('(max-width:760px)');
  const query = useQuery({
    queryKey: ['admin', 'quick-product-prices', id],
    queryFn: async ({ signal }) => {
      const [detail, fields] = await Promise.all([
        api<unknown>(productWorkspaceBase + '/products/' + id, { signal }),
        api<unknown>(productWorkspaceBase + '/fields', { signal }),
      ]);
      return { detail: readWorkspaceDetail(detail, id), fields: readFormFields(fields) };
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  return (
    <Dialog
      open
      fullWidth
      fullScreen={compact}
      maxWidth="lg"
      className="quick-price-dialog"
      aria-labelledby="quick-prices-title"
      aria-describedby={!query.isPending && query.data ? 'quick-prices-summary' : undefined}
      onClose={query.isPending || query.error ? onClose : undefined}
    >
      {query.isPending ? (
        <>
          <DialogTitle id="quick-prices-title">تغییر سریع قیمت</DialogTitle>
          <DialogContent className="quick-price-body" dividers>
            <Stack direction="row" sx={{ gap: 1.25, alignItems: 'center' }} role="status">
              <CircularProgress aria-hidden="true" size={18} />
              در حال دریافت قیمت تنوع‌ها
            </Stack>
          </DialogContent>
          <DialogActions className="quick-price-footer">
            <Button onClick={onClose}>بستن</Button>
          </DialogActions>
        </>
      ) : query.error ? (
        <>
          <DialogTitle id="quick-prices-title">تغییر سریع قیمت</DialogTitle>
          <DialogContent className="quick-price-body" dividers>
            <Alert severity="error">{query.error.message}</Alert>
          </DialogContent>
          <DialogActions className="quick-price-footer">
            <Button onClick={onClose}>بازگشت</Button>
            <Button variant="contained" onClick={() => void query.refetch()}>
              تلاش دوباره
            </Button>
          </DialogActions>
        </>
      ) : query.data ? (
        <QuickPricesForm key={id} value={query.data} viewerId={viewerId} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}
const formatCount = new Intl.NumberFormat('fa-IR').format;

function formattedPrice(value: string) {
  const rial = tomanToRial(value);
  return rial === null ? value : moneyLabel(rial).replace(/ تومان$/, '');
}

function QuickPricesForm({
  value,
  viewerId,
  onClose,
}: {
  value: {
    detail: ReturnType<typeof readWorkspaceDetail>;
    fields: ReturnType<typeof readFormFields>;
  };
  viewerId: string;
  onClose: () => void;
}) {
  const product = value.detail.product;
  const [rows, setRows] = useState(() =>
      draftOfProduct(product, '', []).variants.map((row) => ({
        ...row,
        price: formattedPrice(row.price),
        referencePrice: formattedPrice(row.referencePrice),
      })),
    ),
    [errors, setErrors] = useState<ProductFieldErrors>({}),
    [discard, setDiscard] = useState(false);
  const command = useProductCommand(viewerId);
  const change = useCallback((transform: (old: ProductVariantDraft[]) => ProductVariantDraft[]) => {
    setRows(transform);
    setErrors({});
  }, []);
  const originalPrices = useMemo(
    () => new Map(product.variants.map((variant) => [variant.id, variant])),
    [product.variants],
  );
  const changed = rows.filter((row) => {
    const old = row.id && originalPrices.get(row.id);
    if (!old) return false;
    return (
      tomanToRial(row.price) !== old.priceRial ||
      (row.referencePrice.trim() ? tomanToRial(row.referencePrice) : undefined) !==
        old.compareAtPriceRial
    );
  });
  function close() {
    if (command.blocked) return;
    if (changed.length) setDiscard(true);
    else onClose();
  }
  async function save() {
    const invalid: ProductFieldErrors = {};
    for (const row of rows) {
      const price = tomanToRial(row.price),
        reference = row.referencePrice.trim() ? tomanToRial(row.referencePrice) : null;
      if (price === null) invalid['variants.' + row.key + '.price'] = 'قیمت تومان معتبر وارد کنید.';
      if (
        row.referencePrice.trim() &&
        (reference === null || (price !== null && BigInt(reference) < BigInt(price)))
      )
        invalid['variants.' + row.key + '.referencePrice'] =
          'قیمت پیش از تخفیف نباید کمتر از فروش باشد.';
    }
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    if (!changed.length) {
      onClose();
      return;
    }
    if (changed.length > 100) {
      command.setError(new Error('در هر نوبت حداکثر ۱۰۰ تنوع را ثبت کنید.'));
      return;
    }
    try {
      await command.send('prices', value.detail.product.id, {
        productId: value.detail.product.id,
        version: value.detail.product.version,
        lines: changed.map((row) => ({
          variantId: row.id,
          version: row.version,
          priceRial: tomanToRial(row.price),
          compareAtRial: row.referencePrice.trim() ? tomanToRial(row.referencePrice) : null,
          isActive: row.isActive,
        })),
      });
      onClose();
    } catch {
      /* Preserve the exact attempt for recovery. */
    }
  }
  async function recover(retry = false) {
    try {
      const receipt = await (retry ? command.retrySame() : command.recover());
      if (receipt?.kind === 'prices' && receipt.productId === value.detail.product.id) onClose();
    } catch {
      /* Visible command error. */
    }
  }
  return (
    <>
      <div className="quick-price-heading">
        <span className="quick-price-symbol" aria-hidden="true">
          <Tags size={23} />
        </span>
        <div>
          <DialogTitle id="quick-prices-title" sx={{ p: 0, fontWeight: 800 }}>
            تغییر سریع قیمت
          </DialogTitle>
          <Typography className="quick-price-product" variant="body2">
            {product.translations.find((translation) => translation.locale === 'fa')?.name ||
              product.translations[0]?.name ||
              product.id}
          </Typography>
        </div>
        <IconButton
          className="quick-price-close"
          onClick={close}
          disabled={command.blocked}
          aria-label="بستن پنجرهٔ تغییر قیمت"
        >
          <X size={20} />
        </IconButton>
      </div>
      <DialogContent className="quick-price-body" dividers>
        <Stack spacing={2}>
          <Typography id="quick-prices-summary" color="text.secondary" variant="body2">
            قیمت فروش یا قیمت پیش از تخفیف را در همان ردیف ویرایش کنید. تغییرات با ثبت نهایی اعمال
            می‌شوند.
          </Typography>
          <ProductVariantsTable
            rows={rows}
            fields={value.fields.fields}
            errors={errors}
            disabled={command.blocked || value.detail.archived}
            pricingOnly
            onChange={change}
            onEdit={() => {}}
            onGenerate={() => {}}
          />
          {command.error instanceof Error && (
            <Alert severity="error">{command.error.message}</Alert>
          )}
          {command.attempt?.phase === 'unknown' && (
            <Alert
              severity="warning"
              action={
                <Stack direction="row">
                  <Button onClick={() => void recover()}>بررسی رسید</Button>
                  <Button onClick={() => void recover(true)}>تکرار همان تلاش</Button>
                </Stack>
              }
            >
              نتیجهٔ ثبت مشخص نیست؛ فقط رسید همین تغییر را بررسی کنید.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions className="quick-price-footer" disableSpacing>
        <Typography role="status" variant="body2" color="text.secondary">
          {changed.length
            ? formatCount(changed.length) + ' تنوع با تغییر ذخیره‌نشده'
            : 'هنوز قیمتی تغییر نکرده است'}
        </Typography>
        <Stack direction="row" spacing={1} className="quick-price-footer-buttons">
          <Button disabled={command.blocked} onClick={close}>
            بازگشت
          </Button>
          <Button
            variant="contained"
            disabled={command.blocked || value.detail.archived || changed.length === 0}
            onClick={() => void save()}
          >
            ثبت تغییرات قیمت
          </Button>
        </Stack>
      </DialogActions>
      {discard && (
        <Dialog open maxWidth="xs" onClose={() => setDiscard(false)}>
          <DialogTitle>قیمت‌های تغییرکرده ذخیره نشده‌اند</DialogTitle>
          <DialogActions>
            <Button onClick={() => setDiscard(false)}>ادامهٔ ویرایش</Button>
            <Button color="error" onClick={onClose}>
              بستن بدون ذخیره
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
