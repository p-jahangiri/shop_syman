import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import { Plus, Trash2, WandSparkles } from 'lucide-react';
import type { AttributeDefinition } from '../../types/types';
import { ProductTextField } from './product-editor-fields';
import {
  blankProductVariant,
  normalizedDigits,
  tomanToRial,
  variantCandidates,
  type ProductValueInput,
  type ProductVariantDraft,
  type VariantAxis,
  type VariantColorChoice,
} from './product-editor-model';

export function ProductVariantGenerator({
  definitions,
  current,
  prefix: initialPrefix,
  shared,
  onApply,
  onClose,
}: {
  definitions: AttributeDefinition[];
  current: ProductVariantDraft[];
  prefix: string;
  shared: ProductValueInput[];
  onApply: (rows: ProductVariantDraft[]) => void;
  onClose: () => void;
}) {
  const [prefix, setPrefix] = useState(initialPrefix.toUpperCase().slice(0, 70));
  const [colors, setColors] = useState<(VariantColorChoice & { key: string })[]>([]);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [free, setFree] = useState<Record<string, string>>({});
  const [price, setPrice] = useState(''),
    [warranty, setWarranty] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof variantCandidates> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  function axes(): VariantAxis[] {
    return definitions.flatMap<VariantAxis>((definition) => {
      const ids = selections[definition.id] ?? [],
        text = free[definition.id] ?? '';
      if (definition.dataType === 'Select')
        return ids.length
          ? [
              {
                definition,
                choices: definition.options
                  .filter((o) => ids.includes(o.id))
                  .map((o) => ({
                    labelFa: o.labelFa,
                    labelEn: o.labelEn,
                    value: { attributeId: definition.id, optionId: o.id },
                  })),
              },
            ]
          : [];
      if (definition.dataType === 'Bool')
        return ids.length
          ? [
              {
                definition,
                choices: ids.map((id) => ({
                  labelFa: id === 'true' ? 'بله' : 'خیر',
                  labelEn: id === 'true' ? 'Yes' : 'No',
                  value: { attributeId: definition.id, bool: id === 'true' },
                })),
              },
            ]
          : [];
      const items = text
        .split(/[,،\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!items.length) return [];
      return [
        {
          definition,
          choices: items.map((item) => {
            if (definition.dataType === 'Number') {
              const number = Number(normalizedDigits(item));
              if (!Number.isFinite(number) || Math.abs(number) >= 1e20)
                throw new Error('مقدار عددی ' + definition.key + ' معتبر نیست.');
              return {
                labelFa: item + (definition.unit ? ' ' + definition.unit : ''),
                labelEn: normalizedDigits(item) + (definition.unit ? ' ' + definition.unit : ''),
                value: { attributeId: definition.id, number },
              };
            }
            return {
              labelFa: item,
              labelEn: item,
              value: { attributeId: definition.id, textFa: item, textEn: item },
            };
          }),
        },
      ];
    });
  }
  function prepare() {
    setError('');
    if (!prefix.trim() || prefix.length > 70) {
      setError('پیشوند کد تنوع را بین۱تا۷۰نویسه وارد کنید.');
      return;
    }
    if (colors.some((c) => !c.nameFa.trim() || !/^#[a-f0-9]{6}$/i.test(c.hex))) {
      setError('نام و رنگ ردیف‌های رنگ را کامل کنید.');
      return;
    }
    if (price && tomanToRial(price) === null) {
      setError('قیمت پایه را به تومان معتبر وارد کنید.');
      return;
    }
    try {
      const rows = variantCandidates(colors, axes(), current);
      setPreview(rows);
      setSelected(new Set(rows.map((r) => r.signature)));
      if (!rows.length) setError('همهٔ ترکیب‌های انتخابی از قبل در جدول وجود دارند.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'ترکیب‌ها معتبر نیستند.');
    }
  }
  function apply() {
    if (!preview) return;
    if (current.length + selected.size > 500) {
      setError('مجموع تنوع‌های کالا حداکثر۵۰۰ردیف است؛ ردیف‌های کمتری انتخاب کنید.');
      return;
    }
    const skus = new Set(current.map((v) => v.sku.trim().toUpperCase()));
    let sequence = 1;
    const rows = preview
      .filter((r) => selected.has(r.signature))
      .map((row) => {
        let sku: string;
        do {
          sku = prefix.trim().toUpperCase() + '-' + String(sequence++).padStart(2, '0');
        } while (skus.has(sku));
        skus.add(sku);
        return {
          ...blankProductVariant(crypto.randomUUID()),
          sku,
          price,
          warrantyFa: warranty,
          warrantyEn: warranty,
          color: row.color.hex,
          colorNameFa: row.color.nameFa,
          colorNameEn: row.color.nameEn || row.color.nameFa,
          labelFa: row.labelFa,
          labelEn: row.labelEn,
          attributes: row.attributes,
        };
      });
    if (rows.length) onApply(rows);
  }
  return (
    <Dialog open maxWidth="md" onClose={onClose} aria-labelledby="variant-generator-title">
      <DialogTitle id="variant-generator-title">ساخت گروهی تنوع‌ها</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Alert severity="info">
            رنگ و ویژگی‌های متفاوت را انتخاب کنید، ترکیب‌ها را ببینید و فقط ردیف‌های موردنظر را
            اضافه کنید. ثبت موجودی از بخش انبار انجام می‌شود.
          </Alert>
          {!preview ? (
            <>
              <Box
                sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}
              >
                <ProductTextField
                  label="پیشوند کد تنوع"
                  path="generator.prefix"
                  help="کد هر ردیف به‌صورت خودکار و یکتا در همین کالا ساخته می‌شود؛ در جدول قابل ویرایش است."
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  slotProps={{ htmlInput: { dir: 'ltr', maxLength: 70 } }}
                />
                <ProductTextField
                  label="قیمت پایهٔ ردیف‌های جدید (تومان)"
                  path="generator.price"
                  help="اختیاری؛ پس از ساخت می‌توانید قیمت هر ردیف را مستقل یا گروهی تغییر دهید."
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                />
              </Box>
              <Typography variant="subtitle2">رنگ‌های موردنظر</Typography>
              {colors.map((color) => (
                <Box
                  key={color.key}
                  sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'flex-start' }}
                >
                  <Box sx={{ width: 72, flexShrink: 0 }}>
                    <ProductTextField
                      label="رنگ"
                      path={'generator.color.' + color.key}
                      type="color"
                      value={/^#[a-f0-9]{6}$/i.test(color.hex) ? color.hex : '#ffffff'}
                      onChange={(e) =>
                        setColors((old) =>
                          old.map((c) => (c.key === color.key ? { ...c, hex: e.target.value } : c)),
                        )
                      }
                      sx={{ '& input[type="color"]': { p: 0.5, height: 42, minHeight: 42 } }}
                    />
                  </Box>
                  <Box sx={{ width: 130, flexShrink: 0 }}>
                    <ProductTextField
                      label="کد HEX"
                      help="رنگ را انتخاب کنید یا کد شش‌رقمی آن را مثل #151515 وارد کنید."
                      path={'generator.color-hex.' + color.key}
                      value={color.hex}
                      error={
                        color.hex && !/^#[a-f0-9]{6}$/i.test(color.hex)
                          ? 'کد رنگ شش‌رقمی، مانند #151515 وارد کنید.'
                          : undefined
                      }
                      onChange={(e) =>
                        setColors((old) =>
                          old.map((c) => (c.key === color.key ? { ...c, hex: e.target.value } : c)),
                        )
                      }
                      slotProps={{ htmlInput: { dir: 'ltr', maxLength: 7 } }}
                    />
                  </Box>
                  <Box sx={{ flex: '1 1 180px' }}>
                    <ProductTextField
                      label="نام رنگ"
                      path={'generator.color-name.' + color.key}
                      value={color.nameFa}
                      onChange={(e) =>
                        setColors((old) =>
                          old.map((c) =>
                            c.key === color.key ? { ...c, nameFa: e.target.value } : c,
                          ),
                        )
                      }
                    />
                  </Box>
                  <IconButton
                    aria-label="حذف رنگ"
                    onClick={() => setColors((old) => old.filter((c) => c.key !== color.key))}
                  >
                    <Trash2 size={18} />
                  </IconButton>
                </Box>
              ))}
              <Button
                startIcon={<Plus size={16} />}
                onClick={() =>
                  setColors((old) => [
                    ...old,
                    { key: crypto.randomUUID(), hex: '#60685b', nameFa: '', nameEn: '' },
                  ])
                }
              >
                افزودن رنگ
              </Button>
              {definitions.map((definition) => {
                const label =
                  definition.translations.find((t) => t.locale === 'fa')?.name || definition.key;
                const base = shared.find((v) => v.attributeId === definition.id);
                return (
                  <Box key={definition.id}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      {label}
                      {base ? ' · مقدار مشترک هم ثبت شده' : ''}
                    </Typography>
                    {definition.dataType === 'Select' || definition.dataType === 'Bool' ? (
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {(definition.dataType === 'Bool'
                          ? [
                              { id: 'true', labelFa: 'بله' },
                              { id: 'false', labelFa: 'خیر' },
                            ]
                          : definition.options
                        ).map((option) => (
                          <Chip
                            key={option.id}
                            label={option.labelFa}
                            clickable
                            aria-pressed={(selections[definition.id] ?? []).includes(option.id)}
                            variant={
                              (selections[definition.id] ?? []).includes(option.id)
                                ? 'filled'
                                : 'outlined'
                            }
                            color={
                              (selections[definition.id] ?? []).includes(option.id)
                                ? 'primary'
                                : 'default'
                            }
                            onClick={() =>
                              setSelections((old) => ({
                                ...old,
                                [definition.id]: (old[definition.id] ?? []).includes(option.id)
                                  ? old[definition.id].filter((id) => id !== option.id)
                                  : [...(old[definition.id] ?? []), option.id],
                              }))
                            }
                          />
                        ))}
                      </Box>
                    ) : (
                      <ProductTextField
                        label={label + 'های موردنظر'}
                        path={'generator.axis.' + definition.id}
                        help="چند مقدار را با ویرگول جدا کنید؛ مثلاً ۸،۱۶،۳۲. مقدار انتخاب‌نشده از مشخصات مشترک به ارث می‌رسد."
                        value={free[definition.id] ?? ''}
                        onChange={(e) =>
                          setFree((old) => ({ ...old, [definition.id]: e.target.value }))
                        }
                      />
                    )}
                  </Box>
                );
              })}
              <ProductTextField
                label="گارانتی مشترک ردیف‌های جدید (اختیاری)"
                path="generator.warranty"
                help="شرایط واقعی گارانتی را بنویسید؛ هر ردیف بعداً مستقل قابل تغییر است."
                value={warranty}
                onChange={(e) => setWarranty(e.target.value)}
              />
            </>
          ) : (
            <>
              <Typography variant="subtitle2">
                {preview.length.toLocaleString('fa-IR')} ترکیب جدید ·{' '}
                {selected.size.toLocaleString('fa-IR')} ردیف انتخاب‌شده
              </Typography>
              <FormControlLabel
                label="انتخاب همه"
                control={
                  <Checkbox
                    checked={preview.length > 0 && selected.size === preview.length}
                    indeterminate={selected.size > 0 && selected.size < preview.length}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(preview.map((r) => r.signature)) : new Set(),
                      )
                    }
                  />
                }
              />
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  maxHeight: 350,
                  overflow: 'auto',
                }}
              >
                {preview.map((row) => (
                  <FormControlLabel
                    key={row.signature}
                    label={row.labelFa || 'تنوع پیش‌فرض'}
                    control={
                      <Checkbox
                        checked={selected.has(row.signature)}
                        onChange={(e) =>
                          setSelected((old) => {
                            const next = new Set(old);
                            if (e.target.checked) next.add(row.signature);
                            else next.delete(row.signature);
                            return next;
                          })
                        }
                      />
                    }
                  />
                ))}
              </Box>
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>انصراف</Button>
        {preview ? (
          <>
            <Button onClick={() => setPreview(null)}>تغییر انتخاب‌ها</Button>
            <Button variant="contained" disabled={!selected.size} onClick={apply}>
              افزودن {selected.size.toLocaleString('fa-IR')} تنوع به جدول
            </Button>
          </>
        ) : (
          <Button variant="contained" startIcon={<WandSparkles size={16} />} onClick={prepare}>
            دیدن ترکیب‌ها
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
