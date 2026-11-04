import { useId, useState, type FormEvent, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { Plus, Trash2 } from 'lucide-react';
import { adminListMatches } from '../../utils/admin-list-text';
import { ApiError } from '../../api/api';
import { useSave } from '../../components/forms/forms';
import { ImageEditor } from '../media/media';
import { normalizedDigits } from '../catalog/product-editor-model';
import { ErrorBox } from '../../components/ui';
import type {
  AttributeDefinition,
  Brand,
  Catalog,
  Category,
  CategoryAttribute,
  Translation,
} from '../../types/types';
import {
  attributeTypeLabels,
  categoryParentOptions,
  hasOptions,
  metadataIdentifierError,
  metadataName,
  metadataOptions,
  metadataTranslations,
  type MetadataKind,
} from './catalog-metadata-model';

type SaveState = ReturnType<typeof useSave>;
const number = new Intl.NumberFormat('fa-IR');
const blankRule = (attributeId: string, sortOrder: number): CategoryAttribute => ({
  attributeId,
  sortOrder,
  groupName: 'general',
  isRequired: false,
  isFilterable: true,
  isComparable: true,
  showInSpecs: true,
  isVariantAxis: false,
});
const ruleOptions = [
  ['isRequired', 'اجباری'],
  ['isFilterable', 'فیلتر فروشگاه'],
  ['isComparable', 'مقایسه'],
  ['showInSpecs', 'نمایش در مشخصات'],
  ['isVariantAxis', 'محور تنوع'],
] as const;

function MetadataForm({
  title,
  onClose,
  onSave,
  mutation,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  mutation: SaveState;
  busy?: boolean;
  children: ReactNode;
}) {
  const titleId = useId(),
    formId = useId();
  const blocked = mutation.isPending || busy;
  return (
    <Dialog
      open
      fullWidth
      maxWidth="md"
      aria-labelledby={titleId}
      onClose={(_, reason) => {
        if (!blocked && reason === 'escapeKeyDown') onClose();
      }}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent dividers>
        <form id={formId} className="catalog-meta-form" noValidate onSubmit={onSave}>
          <ErrorBox error={mutation.error} />
          <fieldset disabled={blocked} className="catalog-meta-fields">
            {children}
          </fieldset>
        </form>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={blocked}>
          انصراف
        </Button>
        <Button type="submit" form={formId} variant="contained" disabled={blocked}>
          {mutation.isPending ? 'در حال ذخیره…' : 'ذخیره تغییرات'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function invalid(form: HTMLFormElement) {
  requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}
const requiredText = (value: string, limit: number) =>
  !value.trim()
    ? 'این فیلد الزامی است.'
    : value.length > limit
      ? 'حداکثر ' + number.format(limit) + ' نویسه وارد کنید.'
      : undefined;
function codeError(error: unknown, ...codes: string[]) {
  return error instanceof ApiError && codes.includes(error.code) ? error.message : undefined;
}

function Titles({
  values,
  onChange,
  submitted,
  description = false,
}: {
  values: Translation[];
  onChange: (values: Translation[]) => void;
  submitted: boolean;
  description?: boolean;
}) {
  return (
    <div className="catalog-meta-form-grid">
      {values.map((tr) => {
        const patch = (fields: Partial<Translation>) =>
          onChange(values.map((v) => (v.locale === tr.locale ? { ...v, ...fields } : v)));
        const nameError = submitted ? requiredText(tr.name, 250) : undefined;
        const descError =
          submitted && tr.description.length > 8000 ? 'حداکثر ۸٬۰۰۰ نویسه وارد کنید.' : undefined;
        return (
          <Stack key={tr.locale} spacing={1.5}>
            <TextField
              required
              label={tr.locale === 'fa' ? 'عنوان فارسی' : 'عنوان انگلیسی'}
              value={tr.name}
              onChange={(event) => patch({ name: event.target.value })}
              error={Boolean(nameError)}
              helperText={nameError}
              slotProps={{ htmlInput: { dir: tr.locale === 'en' ? 'ltr' : 'rtl', maxLength: 250 } }}
            />
            {description && (
              <TextField
                label={tr.locale === 'fa' ? 'توضیحات فارسی' : 'توضیحات انگلیسی'}
                multiline
                minRows={2}
                value={tr.description}
                onChange={(event) => patch({ description: event.target.value })}
                error={Boolean(descError)}
                helperText={descError}
                slotProps={{
                  htmlInput: { dir: tr.locale === 'en' ? 'ltr' : 'rtl', maxLength: 8000 },
                }}
              />
            )}
          </Stack>
        );
      })}
    </div>
  );
}
const validTitles = (values: Translation[]) =>
  values.every((tr) => !requiredText(tr.name, 250) && tr.description.length <= 8000);

function Identifier({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <TextField
      required
      label={label}
      value={value}
      error={Boolean(error)}
      helperText={error ?? 'فقط حروف کوچک انگلیسی، عدد و خط تیره.'}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { dir: 'ltr', maxLength: 150 } }}
    />
  );
}
function Active({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <FormControlLabel
      control={<Switch checked={checked} onChange={(_, next) => onChange(next)} />}
      label={label}
    />
  );
}

function BrandForm({
  item,
  data,
  title,
  onClose,
}: {
  item?: Brand;
  data: Catalog;
  title: string;
  onClose: () => void;
}) {
  const [upload, setUpload] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [value, set] = useState(() => ({
    name: item?.name ?? '',
    slug: item?.slug ?? '',
    logoUrl: item?.logoUrl ?? '',
    isActive: item?.isActive ?? true,
    version: item?.version,
  }));
  const mutation = useSave(
    '/admin/brands' + (item ? '/' + encodeURIComponent(item.id) : ''),
    onClose,
  );
  const nameError = requiredText(value.name, 120);
  const slugError = metadataIdentifierError(
    value.slug.trim(),
    !data.brands.some((b) => b.id !== item?.id && b.slug === value.slug.trim()),
  );
  return (
    <MetadataForm
      title={title}
      onClose={onClose}
      busy={upload}
      mutation={mutation}
      onSave={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (nameError || slugError) {
          invalid(event.currentTarget);
          return;
        }
        if (!mutation.isPending && !upload)
          mutation.mutate({ ...value, name: value.name.trim(), slug: value.slug.trim() });
      }}
    >
      <div className="catalog-meta-form-grid">
        <TextField
          required
          label="نام برند"
          value={value.name}
          error={Boolean(submitted && nameError)}
          helperText={submitted ? nameError : undefined}
          onChange={(event) => set({ ...value, name: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 120 } }}
        />
        <Identifier
          label="نشانی برند"
          value={value.slug}
          onChange={(slug) => set({ ...value, slug })}
          error={(submitted ? slugError : undefined) ?? codeError(mutation.error, 'invalid_slug')}
        />
      </div>
      <Active
        label="برند فعال است"
        checked={value.isActive}
        onChange={(isActive) => set({ ...value, isActive })}
      />
      <ImageEditor
        label="لوگوی برند (اختیاری)"
        max={1}
        value={value.logoUrl ? [value.logoUrl] : []}
        onChange={(urls) => set((old) => ({ ...old, logoUrl: urls[0] ?? '' }))}
        onBusy={setUpload}
      />
    </MetadataForm>
  );
}

function CategoryRules({
  attributes,
  rules,
  onChange,
}: {
  attributes: AttributeDefinition[];
  rules: CategoryAttribute[];
  onChange: (rules: CategoryAttribute[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [linkedOnly, setLinkedOnly] = useState(false);
  const indexed = new Map(rules.map((rule) => [rule.attributeId, rule]));
  const nextOrder = Math.max(-1, ...rules.map((rule) => rule.sortOrder)) + 1;
  const matching = attributes.filter(
    (a) =>
      (!linkedOnly || indexed.has(a.id)) &&
      adminListMatches(
        [a.key, attributeTypeLabels[a.dataType], ...a.translations.map((tr) => tr.name)],
        search,
      ),
  );
  return (
    <section className="catalog-rule-section" aria-label="ویژگی‌های دسته">
      <div className="catalog-option-heading">
        <div>
          <h3>ویژگی‌های دسته</h3>
          <p>ویژگی‌های لازم برای فرم کالا، فیلتر و نمایش مشخصات را انتخاب کنید.</p>
        </div>
        <Chip
          label={number.format(rules.length) + ' متصل'}
          size="small"
          color="info"
          variant="outlined"
        />
      </div>
      <div className="catalog-meta-form-grid">
        <TextField
          label="جست‌وجوی ویژگی"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Active label="فقط ویژگی‌های متصل" checked={linkedOnly} onChange={setLinkedOnly} />
      </div>
      <div className="catalog-rule-list">
        {matching.map((a) => {
          const rule = indexed.get(a.id);
          const title = metadataName(a, a.key);
          return (
            <div className="catalog-rule" key={a.id}>
              <div className="catalog-option-heading">
                <Active
                  checked={Boolean(rule)}
                  label={title}
                  onChange={(checked) =>
                    onChange(
                      checked
                        ? [...rules, blankRule(a.id, nextOrder)]
                        : rules.filter((item) => item.attributeId !== a.id),
                    )
                  }
                />
                <Chip label={attributeTypeLabels[a.dataType]} size="small" variant="outlined" />
              </div>
              {rule && (
                <div className="catalog-rule-flags">
                  {ruleOptions.map(([key, label]) => (
                    <FormControlLabel
                      key={key}
                      control={
                        <Switch
                          size="small"
                          checked={rule[key]}
                          disabled={
                            key === 'isVariantAxis' && a.dataType === 'MultiSelect' && !rule[key]
                          }
                          slotProps={{ input: { 'aria-label': label + ' ' + title } }}
                          onChange={(_, checked) =>
                            onChange(
                              rules.map((item) =>
                                item.attributeId === a.id ? { ...item, [key]: checked } : item,
                              ),
                            )
                          }
                        />
                      }
                      label={label}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!matching.length && <p className="muted">ویژگی منطبق پیدا نشد.</p>}
      </div>
    </section>
  );
}

function CategoryForm({
  item,
  data,
  title,
  onClose,
}: {
  item?: Category;
  data: Catalog;
  title: string;
  onClose: () => void;
}) {
  const [upload, setUpload] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [value, set] = useState(() => ({
    slug: item?.slug ?? '',
    parentId: item?.parentId ?? null,
    imageUrl: item?.imageUrl ?? '/products/phone-silver.svg',
    sortOrder: String(item?.sortOrder ?? 0),
    isActive: item?.isActive ?? true,
    translations: metadataTranslations(item?.translations),
    attributes: item?.attributes ?? [],
    version: item?.version,
  }));
  const mutation = useSave(
    '/admin/categories' + (item ? '/' + encodeURIComponent(item.id) : ''),
    onClose,
  );
  const slugError = metadataIdentifierError(
    value.slug.trim(),
    !data.categories.some((c) => c.id !== item?.id && c.slug === value.slug.trim()),
  );
  const parents = categoryParentOptions(data.categories, item?.id);
  const invalidParent = Boolean(value.parentId && !parents.some((c) => c.id === value.parentId));
  const order = normalizedDigits(value.sortOrder.trim());
  const sortError =
    !/^-?\d{1,10}$/.test(order) || Number(order) < -2147483648 || Number(order) > 2147483647;
  const invalidAxis = data.attributes.some(
    (a) =>
      a.dataType === 'MultiSelect' &&
      value.attributes.some((rule) => rule.attributeId === a.id && rule.isVariantAxis),
  );
  const parentError = invalidParent
    ? 'یک دستهٔ والد معتبر انتخاب کنید.'
    : codeError(mutation.error, 'invalid_category_tree');
  return (
    <MetadataForm
      title={title}
      onClose={onClose}
      busy={upload}
      mutation={mutation}
      onSave={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (
          slugError ||
          invalidParent ||
          sortError ||
          !value.imageUrl ||
          invalidAxis ||
          !validTitles(value.translations)
        ) {
          invalid(event.currentTarget);
          return;
        }
        if (!mutation.isPending && !upload)
          mutation.mutate({ ...value, slug: value.slug.trim(), sortOrder: Number(order) });
      }}
    >
      <Titles
        values={value.translations}
        onChange={(translations) => set({ ...value, translations })}
        submitted={submitted}
        description
      />
      <div className="catalog-meta-form-grid">
        <Identifier
          label="نشانی دسته"
          value={value.slug}
          onChange={(slug) => set({ ...value, slug })}
          error={(submitted ? slugError : undefined) ?? codeError(mutation.error, 'invalid_slug')}
        />
        <TextField
          select
          label="دستهٔ والد"
          value={value.parentId ?? ''}
          error={Boolean(parentError)}
          helperText={parentError ?? 'برای دسته‌های اصلی، «بدون والد» را انتخاب کنید.'}
          onChange={(event) => set({ ...value, parentId: event.target.value || null })}
        >
          <MenuItem value="">بدون والد</MenuItem>
          {invalidParent && (
            <MenuItem value={value.parentId!} disabled>
              والد فعلی نامعتبر است
            </MenuItem>
          )}
          {parents.map((p) => (
            <MenuItem
              key={p.id}
              value={p.id}
              sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
            >
              {metadataName(p, p.slug)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="ترتیب نمایش"
          value={value.sortOrder}
          onChange={(event) => set({ ...value, sortOrder: event.target.value })}
          error={submitted && sortError}
          helperText={
            submitted && sortError ? 'عدد صحیح معتبر وارد کنید.' : 'عدد کمتر، نمایش زودتر.'
          }
          slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
        />
        <Active
          label="دسته فعال است"
          checked={value.isActive}
          onChange={(isActive) => set({ ...value, isActive })}
        />
      </div>
      {submitted && !value.imageUrl && (
        <Alert severity="error">یک تصویر برای دسته انتخاب کنید.</Alert>
      )}
      <ImageEditor
        label="تصویر دسته"
        max={1}
        value={value.imageUrl ? [value.imageUrl] : []}
        onChange={(urls) => set((old) => ({ ...old, imageUrl: urls[0] ?? '' }))}
        onBusy={setUpload}
      />
      {submitted && invalidAxis && (
        <Alert severity="error">
          در بخش ویژگی‌ها، گزینهٔ «محور تنوع» را برای ویژگی چندانتخابی خاموش کنید.
        </Alert>
      )}
      <CategoryRules
        attributes={data.attributes}
        rules={value.attributes}
        onChange={(attributes) => set({ ...value, attributes })}
      />
    </MetadataForm>
  );
}

type DraftOption = AttributeDefinition['options'][number] & { rowKey: string };
function AttributeForm({
  item,
  data,
  title,
  onClose,
}: {
  item?: AttributeDefinition;
  data: Catalog;
  title: string;
  onClose: () => void;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [value, set] = useState(() => ({
    key: item?.key ?? '',
    dataType: item?.dataType ?? 'Text',
    unit: item?.unit ?? '',
    translations: metadataTranslations(item?.translations).map((tr) => ({
      ...tr,
      description: '',
    })),
    options: (item?.options ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((option): DraftOption => ({ ...option, rowKey: option.id })),
    version: item?.version,
  }));
  const mutation = useSave(
    '/admin/attributes' + (item ? '/' + encodeURIComponent(item.id) : ''),
    onClose,
  );
  const keyError = metadataIdentifierError(
    value.key.trim(),
    !data.attributes.some((a) => a.id !== item?.id && a.key === value.key.trim()),
  );
  const axisConflict =
    value.dataType === 'MultiSelect' &&
    Boolean(item) &&
    data.categories.some((c) =>
      c.attributes.some((rule) => rule.attributeId === item!.id && rule.isVariantAxis),
    );
  const optionPayload = metadataOptions(
    value.dataType,
    value.options.map(({ rowKey: _, ...option }) => option),
  );
  const optionValues = new Map<string, number>();
  for (const option of optionPayload) {
    const key = option.value.toLocaleLowerCase('en');
    optionValues.set(key, (optionValues.get(key) ?? 0) + 1);
  }
  const optionError = (option: DraftOption) =>
    requiredText(option.value, 400) ??
    ((optionValues.get(option.value.trim().toLocaleLowerCase('en')) ?? 0) > 1
      ? 'مقدار گزینه باید یکتا باشد.'
      : undefined);
  const updateOption = (rowKey: string, patch: Partial<DraftOption>) =>
    set((old) => ({
      ...old,
      options: old.options.map((option) =>
        option.rowKey === rowKey ? { ...option, ...patch } : option,
      ),
    }));
  const typeError = axisConflict
    ? 'ابتدا این ویژگی را از محورهای تنوع دسته‌های مرتبط بردارید.'
    : codeError(mutation.error, 'attribute_in_use');
  return (
    <MetadataForm
      title={title}
      onClose={onClose}
      mutation={mutation}
      onSave={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (
          keyError ||
          !validTitles(value.translations) ||
          axisConflict ||
          (hasOptions(value.dataType) &&
            value.options.some((o) => optionError(o) || !o.labelFa.trim() || !o.labelEn.trim()))
        ) {
          invalid(event.currentTarget);
          return;
        }
        if (!mutation.isPending)
          mutation.mutate({
            ...value,
            key: value.key.trim(),
            unit: value.unit.trim() || null,
            options: optionPayload,
          });
      }}
    >
      <Titles
        values={value.translations}
        onChange={(translations) => set({ ...value, translations })}
        submitted={submitted}
      />
      <div className="catalog-meta-form-grid">
        <Identifier
          label="کلید ویژگی"
          value={value.key}
          onChange={(key) => set({ ...value, key })}
          error={(submitted ? keyError : undefined) ?? codeError(mutation.error, 'invalid_slug')}
        />
        <TextField
          select
          label="نوع داده"
          value={value.dataType}
          error={Boolean(typeError)}
          helperText={typeError ?? 'نوع داده شکل ورود مقدار در فرم کالا را مشخص می‌کند.'}
          onChange={(event) =>
            set({ ...value, dataType: event.target.value as AttributeDefinition['dataType'] })
          }
        >
          {Object.entries(attributeTypeLabels).map(([id, label]) => (
            <MenuItem key={id} value={id}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="واحد (اختیاری)"
          value={value.unit}
          onChange={(event) => set({ ...value, unit: event.target.value })}
          helperText="مثل گیگابایت یا میلی‌آمپرساعت"
          slotProps={{ htmlInput: { maxLength: 80 } }}
        />
      </div>
      {!hasOptions(value.dataType) && Boolean(item?.options.length) && (
        <Alert severity="warning">
          با ذخیرهٔ این نوع داده، گزینه‌های قبلی از تعریف ویژگی برداشته می‌شوند. گزینه‌های
          استفاده‌شده در کالا قابل حذف نیستند.
        </Alert>
      )}
      {hasOptions(value.dataType) && (
        <section className="catalog-rule-section" aria-label="گزینه‌های ویژگی">
          <div className="catalog-option-heading">
            <div>
              <h3>گزینه‌های قابل انتخاب</h3>
              <p>برای هر گزینه یک مقدار ثابت و دو برچسب وارد کنید.</p>
            </div>
            <Button
              variant="outlined"
              startIcon={<Plus size={16} />}
              onClick={() =>
                set((old) => ({
                  ...old,
                  options: [
                    ...old.options,
                    {
                      id: '',
                      rowKey: crypto.randomUUID(),
                      value: '',
                      labelFa: '',
                      labelEn: '',
                      sortOrder: old.options.length,
                    },
                  ],
                }))
              }
            >
              افزودن گزینه
            </Button>
          </div>
          {value.options.map((o, index) => {
            const error = submitted ? optionError(o) : undefined;
            const faError = submitted && !o.labelFa.trim() ? 'برچسب فارسی الزامی است.' : undefined;
            const enError =
              submitted && !o.labelEn.trim() ? 'برچسب انگلیسی الزامی است.' : undefined;
            return (
              <div className="catalog-option-row" key={o.rowKey}>
                <TextField
                  required
                  label="مقدار ثابت"
                  value={o.value}
                  error={Boolean(error)}
                  helperText={error}
                  onChange={(event) => updateOption(o.rowKey, { value: event.target.value })}
                  slotProps={{ htmlInput: { maxLength: 400, dir: 'auto' } }}
                />
                <TextField
                  required
                  label="برچسب فارسی"
                  value={o.labelFa}
                  error={Boolean(faError)}
                  helperText={faError}
                  onChange={(event) => updateOption(o.rowKey, { labelFa: event.target.value })}
                />
                <TextField
                  required
                  label="برچسب انگلیسی"
                  value={o.labelEn}
                  error={Boolean(enError)}
                  helperText={enError}
                  onChange={(event) => updateOption(o.rowKey, { labelEn: event.target.value })}
                  slotProps={{ htmlInput: { dir: 'ltr' } }}
                />
                <Button
                  color="error"
                  aria-label={'حذف گزینهٔ ' + number.format(index + 1)}
                  onClick={() =>
                    set((old) => ({
                      ...old,
                      options: old.options.filter((option) => option.rowKey !== o.rowKey),
                    }))
                  }
                >
                  <Trash2 size={17} />
                </Button>
              </div>
            );
          })}
          {!value.options.length && <p className="muted">هنوز گزینه‌ای تعریف نشده است.</p>}
        </section>
      )}
    </MetadataForm>
  );
}

export function CatalogMetadataDialog({
  kind,
  id,
  label,
  data,
  onClose,
}: {
  kind: MetadataKind;
  id: string | null;
  label: string;
  data: Catalog;
  onClose: () => void;
}) {
  const title = (id ? 'ویرایش ' : 'افزودن ') + label;
  if (kind === 'brands')
    return (
      <BrandForm
        item={data.brands.find((item) => item.id === id)}
        data={data}
        title={title}
        onClose={onClose}
      />
    );
  if (kind === 'categories')
    return (
      <CategoryForm
        item={data.categories.find((item) => item.id === id)}
        data={data}
        title={title}
        onClose={onClose}
      />
    );
  return (
    <AttributeForm
      item={data.attributes.find((item) => item.id === id)}
      data={data}
      title={title}
      onClose={onClose}
    />
  );
}
