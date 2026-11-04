import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/api';
import { ProductTextField } from './product-editor-fields';
import { nameOf, type AttributeDefinition, type Catalog } from '../../types/types';

export function ProductQuickCreate({
  kind,
  data,
  onCreated,
  onClose,
  item,
}: {
  kind: 'category' | 'brand' | 'attribute';
  data: Catalog;
  onCreated: (id: string) => void;
  onClose: () => void;
  item?: AttributeDefinition;
}) {
  const client = useQueryClient();
  const content = useRef<HTMLDivElement | null>(null);
  const [name, setName] = useState(item?.translations.find((t) => t.locale === 'fa')?.name ?? ''),
    [english, setEnglish] = useState(item?.translations.find((t) => t.locale === 'en')?.name ?? ''),
    [slug, setSlug] = useState(item?.key ?? ''),
    [parent, setParent] = useState('');
  const [type, setType] = useState<AttributeDefinition['dataType']>(item?.dataType ?? 'Select'),
    [unit, setUnit] = useState(item?.unit ?? '');
  const [options, setOptions] = useState<
    { key: string; id?: string; value: string; labelFa: string; labelEn: string }[]
  >(() => item?.options.map((o) => ({ ...o, key: o.id })) ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const label = kind === 'category' ? 'دسته‌بندی' : kind === 'brand' ? 'برند' : 'ویژگی';
  const selectable = type === 'Select' || type === 'MultiSelect';
  async function submit() {
    const next: Record<string, string> = {};
    if (!name.trim() || name.trim().length > (kind === 'brand' ? 120 : 200))
      next.name = 'نام معتبر وارد کنید.';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 150)
      next.slug = 'حروف کوچک انگلیسی، عدد و خط تیره؛ حداکثر۱۵۰نویسه.';
    if (kind === 'attribute' && selectable) {
      if (!options.length) next.options = 'حداقل یک گزینه اضافه کنید.';
      for (const option of options)
        if (!option.value.trim() || !option.labelFa.trim())
          next['option.' + option.key] = 'مقدار و عنوان گزینه را کامل کنید.';
      if (new Set(options.map((o) => o.value.trim())).size !== options.length)
        next.options = 'مقدار گزینه‌ها باید یکتا باشد.';
    }
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => {
        const path = Object.keys(next)[0];
        content.current
          ?.querySelector<HTMLElement>('[data-field-path="quick.' + CSS.escape(path) + '"] input')
          ?.focus();
      });
      return;
    }
    setBusy(true);
    setError('');
    const translations = [
      { locale: 'fa', name: name.trim(), description: '' },
      { locale: 'en', name: english.trim() || name.trim(), description: '' },
    ];
    const body =
      kind === 'brand'
        ? { name: name.trim(), slug, logoUrl: '', isActive: true, version: null }
        : kind === 'category'
          ? {
              slug,
              parentId: parent || null,
              imageUrl: '/products/sayman-mark-olive-v1.png',
              sortOrder: data.categories.length,
              isActive: true,
              translations,
              attributes: [],
              version: null,
            }
          : {
              key: slug,
              dataType: type,
              unit: unit || null,
              translations,
              options: selectable
                ? options.map((o, i) => ({
                    id: o.id ?? null,
                    value: o.value.trim(),
                    labelFa: o.labelFa.trim(),
                    labelEn: o.labelEn.trim() || o.labelFa.trim(),
                    sortOrder: i,
                  }))
                : [],
              version: item?.version ?? null,
            };
    try {
      const result = await api<{ id: string }>(
        '/admin/' +
          (kind === 'brand' ? 'brands' : kind === 'category' ? 'categories' : 'attributes') +
          (item ? '/' + item.id : ''),
        { method: item ? 'PUT' : 'POST', body: JSON.stringify(body) },
      );
      if (!result || typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(result.id))
        throw new Error('پاسخ ثبت قابل تأیید نیست؛ فهرست را تازه کنید.');
      await client.invalidateQueries({ queryKey: ['admin'] });
      onCreated(result.id);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'ثبت انجام نشد.';
      setError(message);
      if (failure instanceof ApiError && failure.code === 'conflict')
        setErrors((current) => ({
          ...current,
          slug: 'این شناسه ممکن است قبلاً ثبت شده باشد؛ شناسه را بررسی کنید.',
        }));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      maxWidth="sm"
      aria-labelledby="quick-create-title"
    >
      <DialogTitle id="quick-create-title">
        {item ? 'ویرایش' : 'افزودن'} {label}
      </DialogTitle>
      <DialogContent dividers ref={content}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            پس از ساخت، به فرم کالا برمی‌گردید و اطلاعات واردشدهٔ کالا حفظ می‌شود.
          </Alert>
          <ProductTextField
            disabled={busy}
            path="quick.name"
            label={'نام ' + label}
            help="عنوانی که مدیر و مشتری می‌بینند."
            required
            value={name}
            error={errors.name}
            onChange={(e) => setName(e.target.value)}
          />
          <ProductTextField
            disabled={busy}
            path="quick.slug"
            label={kind === 'attribute' ? 'کلید ویژگی' : 'شناسهٔ نشانی'}
            help="شناسهٔ ثابت و یکتا؛ مثلاً phone،samsung یا storage. نام نمایشی فارسی می‌ماند."
            required
            value={slug}
            error={errors.slug}
            onChange={(e) => setSlug(e.target.value)}
            slotProps={{ htmlInput: { dir: 'ltr', maxLength: 150 } }}
          />
          <ProductTextField
            disabled={busy}
            path="quick.english"
            label="نام انگلیسی (اختیاری)"
            help="اگر خالی بماند، نام فارسی به عنوان جایگزین استفاده می‌شود؛ بعداً قابل ویرایش است."
            value={english}
            onChange={(e) => setEnglish(e.target.value)}
          />
          {kind === 'category' && (
            <ProductTextField
              disabled={busy}
              path="quick.parent"
              label="دستهٔ والد"
              help="برای یک دستهٔ مستقل، بدون والد را انتخاب کنید."
              select
              value={parent}
              onChange={(e) => setParent(e.target.value)}
            >
              <MenuItem value="">بدون والد</MenuItem>
              {data.categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {nameOf(c)}
                </MenuItem>
              ))}
            </ProductTextField>
          )}
          {kind === 'attribute' && (
            <>
              <ProductTextField
                disabled={busy}
                path="quick.type"
                label="نوع داده"
                help="نوع بعد از استفاده در کالا به‌سادگی قابل تغییر نیست. برای رنگ/حافظهٔ گزینه‌دار، انتخاب یک گزینه مناسب است."
                select
                value={type}
                onChange={(e) => setType(e.target.value as AttributeDefinition['dataType'])}
              >
                {Object.entries({
                  Select: 'انتخاب یک گزینه',
                  MultiSelect: 'انتخاب چند گزینه',
                  Number: 'عدد',
                  Bool: 'بله / خیر',
                  Text: 'متن',
                }).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </ProductTextField>
              <ProductTextField
                disabled={busy}
                path="quick.unit"
                label="واحد (اختیاری)"
                help="مثل GB،گرم یا وات؛ مبلغ و واحد پول از این فیلد تعیین نمی‌شوند."
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
              {selectable && (
                <Stack spacing={1.5}>
                  <Typography variant="subtitle2">گزینه‌های قابل انتخاب</Typography>
                  {options.map((o, index) => (
                    <Stack
                      key={o.key}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'flex-start' }}
                    >
                      <ProductTextField
                        disabled={busy}
                        path={'quick.option.' + o.key}
                        label={'گزینه ' + (index + 1).toLocaleString('fa-IR')}
                        help="عنوانی که در مشخصات و تنوع‌ها دیده می‌شود."
                        value={o.labelFa}
                        error={errors['option.' + o.key]}
                        onChange={(e) =>
                          setOptions((old) =>
                            old.map((v) =>
                              v.key === o.key
                                ? {
                                    ...v,
                                    labelFa: e.target.value,
                                    value: v.value === v.labelFa ? e.target.value : v.value,
                                  }
                                : v,
                            ),
                          )
                        }
                      />
                      <IconButton
                        type="button"
                        aria-label="حذف گزینه"
                        disabled={busy}
                        onClick={() => setOptions((old) => old.filter((v) => v.key !== o.key))}
                      >
                        <Trash2 size={18} />
                      </IconButton>
                    </Stack>
                  ))}
                  {errors.options && <Alert severity="error">{errors.options}</Alert>}
                  {item && (
                    <Button
                      disabled={busy}
                      onClick={() => setOptions(item.options.map((o) => ({ ...o, key: o.id })))}
                    >
                      بازگرداندن گزینه‌های نسخهٔ بازشده
                    </Button>
                  )}
                  <Button
                    disabled={busy}
                    type="button"
                    startIcon={<Plus size={16} />}
                    onClick={() =>
                      setOptions((old) => [
                        ...old,
                        { key: crypto.randomUUID(), value: '', labelFa: '', labelEn: '' },
                      ])
                    }
                  >
                    افزودن گزینه
                  </Button>
                </Stack>
              )}
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          انصراف
        </Button>
        <Button variant="contained" disabled={busy} onClick={() => void submit()}>
          {busy ? 'در حال ثبت…' : 'ساخت ' + label}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
