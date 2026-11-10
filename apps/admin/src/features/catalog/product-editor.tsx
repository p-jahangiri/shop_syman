import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  X,
  Settings2,
  Package,
  Save,
  Warehouse,
  ListChecks,
  Layers3,
  Images,
  ShoppingBag,
} from 'lucide-react';
import { api, ApiError } from '../../api/api';
import { ImageEditor } from '../media/media';
import { ProductVideos } from './product-videos';
import type { ProductVideo } from '../../api/contracts/catalog/product-video-contract';
import { ProductTextField, ProductAttributeField, ProductField } from './product-editor-fields';
import { ProductVariantsTable } from './product-variants-table';
import { ProductVariantGenerator } from './product-variant-generator';
import { ProductQuickCreate } from './product-quick-create';
import { ProductFormSettings } from './product-form-settings';
import {
  warrantyFields,
  warrantyLibrarySchema,
  warrantyTemplatesPath,
  warrantyTemplatesQuery,
  withDefaultWarranty,
  type WarrantyTemplate,
} from './warranty-templates';
import { useProductCommand } from '../../hooks/use-product-command';
import { productErrorPaths } from './product-field-errors';
import {
  productWorkspaceBase,
  readFormFields,
  type FormFieldsConfiguration,
} from '../../api/contracts/catalog/product-workspace-contract';
import {
  copyProductVariantLayout,
  draftFromSimilarProduct,
  draftOfProduct,
  productInput,
  validProductSlug,
  validateProductDraft,
  type ProductDraft,
  type ProductFieldErrors,
  type ProductValueInput,
  type ProductVariantDraft,
} from './product-editor-model';
import {
  nameOf,
  type Catalog,
  type Product,
  type PurchaseMethod,
  type ChequePlan,
} from '../../types/types';

const editorSections = [
  {
    id: 'identity',
    label: 'اطلاعات پایه',
    icon: Package,
    hint: 'نام، دسته و برند کالا را وارد کنید. توضیحات و ترجمه برای تکمیل صفحهٔ فروشگاه‌اند.',
  },
  {
    id: 'specifications',
    label: 'مشخصات',
    icon: ListChecks,
    hint: 'ویژگی‌های مشترک تمام تنوع‌های این مدل را اینجا وارد کنید.',
  },
  {
    id: 'variants',
    label: 'تنوع و قیمت',
    icon: Layers3,
    hint: 'برای هر ترکیب قابل فروش، کد و قیمت جدا ثبت کنید.',
  },
  {
    id: 'media',
    label: 'رسانه',
    icon: Images,
    hint: 'اولین تصویر، کاور کالا است. ویدیو می‌تواند برای همهٔ کالا یا یک تنوع باشد.',
  },
  {
    id: 'sales',
    label: 'فروش و انتشار',
    icon: ShoppingBag,
    hint: 'مشخص کنید کالا در فروشگاه دیده شود و با چه روش‌هایی قابل خرید باشد.',
  },
] as const;
type EditorSection = (typeof editorSections)[number]['id'];

function sectionForError(path: string): EditorSection {
  if (path === 'variants' || path.startsWith('variants.')) return 'variants';
  if (path.startsWith('attribute.') || path === 'attributes') return 'specifications';
  if (/^(images|imageUrls|videos)(\.|$)/.test(path)) return 'media';
  if (
    /^(status|purchaseMethods|purchaseMethodIds|chequePlanIds|featured|isDigital)(\.|$)/.test(path)
  )
    return 'sales';
  return 'identity';
}
const productStateLabel = { Draft: 'پیش‌نویس', Published: 'منتشرشده', Hidden: 'پنهان' } as const;

function replaceValue(values: ProductValueInput[], id: string, next: ProductValueInput | null) {
  return [...values.filter((v) => v.attributeId !== id), ...(next ? [next] : [])];
}
function focusField(root: HTMLElement | null, path: string) {
  const field = root?.querySelector<HTMLElement>('[data-field-path="' + CSS.escape(path) + '"]');
  if (field?.closest('details')) field.closest('details')!.open = true;
  field?.scrollIntoView({
    block: 'center',
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
  // A field's help button precedes its editor in DOM order. Prefer the actual
  // editable control so validation does not move focus into the help popover.
  const control =
    field?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([hidden]):not([aria-hidden="true"]):not([tabindex="-1"]):not(:disabled),textarea:not(:disabled),select:not(:disabled),[role="combobox"]:not([aria-disabled="true"])',
    ) ??
    field?.querySelector<HTMLElement>(
      'button:not(:disabled):not([data-field-help]),[tabindex="0"]:not([data-field-help])',
    );
  control?.focus({ preventScroll: true });
}
export function ProductEditor({
  item,
  copyFrom,
  videos = [],
  data,
  methods,
  plans,
  viewerId,
  onClose,
  onSaved,
  onInventory,
}: {
  item?: Product;
  copyFrom?: Product;
  videos?: ProductVideo[];
  data: Catalog;
  methods: PurchaseMethod[];
  plans: ChequePlan[];
  viewerId: string;
  onClose: () => void;
  onSaved: (productId: string) => void;
  onInventory?: () => void;
}) {
  const fullScreen = useMediaQuery('(max-width:700px)');
  const fields = useQuery({
    queryKey: ['admin', 'product-form-fields'],
    queryFn: async ({ signal }) =>
      readFormFields(await api<unknown>(productWorkspaceBase + '/fields', { signal })),
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <Dialog
      open
      fullWidth
      maxWidth="xl"
      fullScreen={fullScreen}
      aria-labelledby="product-editor-title"
      slotProps={{
        paper: {
          sx: {
            height: fullScreen ? '100dvh' : 'min(90dvh, 940px)',
            maxHeight: fullScreen ? '100dvh' : 'calc(100dvh - 64px)',
            borderRadius: fullScreen ? 0 : 3,
          },
        },
      }}
    >
      {fields.isPending ? (
        <DialogContent>
          <CircularProgress aria-label="دریافت تنظیمات فرم" />
        </DialogContent>
      ) : fields.error ? (
        <>
          <DialogTitle id="product-editor-title">مدیریت کالا</DialogTitle>
          <DialogContent>
            <Alert
              severity="error"
              action={<Button onClick={() => void fields.refetch()}>تلاش دوباره</Button>}
            >
              {fields.error.message}
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>بازگشت</Button>
          </DialogActions>
        </>
      ) : fields.data ? (
        <ProductEditorForm
          item={item}
          copyFrom={copyFrom}
          videos={videos}
          data={data}
          methods={methods}
          plans={plans}
          viewerId={viewerId}
          configuration={fields.data}
          onClose={onClose}
          onSaved={onSaved}
          onInventory={onInventory}
        />
      ) : null}
    </Dialog>
  );
}
function ProductEditorForm({
  item,
  copyFrom,
  videos,
  data,
  methods,
  plans,
  viewerId,
  configuration,
  onClose,
  onSaved,
  onInventory,
}: {
  item?: Product;
  copyFrom?: Product;
  videos: ProductVideo[];
  data: Catalog;
  methods: PurchaseMethod[];
  plans: ChequePlan[];
  viewerId: string;
  configuration: FormFieldsConfiguration;
  onClose: () => void;
  onSaved: (productId: string) => void;
  onInventory?: () => void;
}) {
  const [value, setValue] = useState(() => {
    const key = crypto.randomUUID();
    return copyFrom
      ? draftFromSimilarProduct(copyFrom, key, methods)
      : { ...draftOfProduct(item, key, methods), videos };
  });
  const warrantyLibrary = useQuery({
    queryKey: warrantyTemplatesQuery,
    queryFn: async ({ signal }) =>
      warrantyLibrarySchema.parse(await api(warrantyTemplatesPath, { signal })),
  });
  const templates = warrantyLibrary.data?.items ?? [];
  const categoryWarranties = templates.filter((entry) =>
    entry.categoryIds.includes(value.categoryId),
  );
  const defaultWarranty = categoryWarranties.find((entry) =>
    entry.defaultCategoryIds.includes(value.categoryId),
  );
  const initial = useRef(JSON.stringify(value));
  const tabsId = useId();
  const [activeSection, setActiveSection] = useState<EditorSection>('identity');
  const [focusRequest, setFocusRequest] = useState<{ path: string } | null>(null);
  const dirty = JSON.stringify(value) !== initial.current;
  const [submitted, setSubmitted] = useState(false),
    [serverErrors, setServerErrors] = useState<ProductFieldErrors>({}),
    [imageBusy, setImageBusy] = useState(false),
    [videoBusy, setVideoBusy] = useState(false),
    [discard, setDiscard] = useState(false);
  const [quick, setQuick] = useState<'category' | 'brand' | null>(null),
    [settings, setSettings] = useState(false),
    [generator, setGenerator] = useState(false),
    [variantKey, setVariantKey] = useState<string | null>(null);
  const command = useProductCommand(viewerId),
    content = useRef<HTMLDivElement | null>(null);
  const errors = useMemo(
    () => ({ ...(submitted ? validateProductDraft(value, data) : {}), ...serverErrors }),
    [value, data, submitted, serverErrors],
  );
  const busy = imageBusy || videoBusy;
  const disabled = command.blocked || busy;
  useEffect(() => {
    if (!dirty && !command.blocked && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, command.blocked, busy]);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [activeSection]);
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => focusField(content.current, focusRequest.path));
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);
  const field = (key: string) => configuration.fields.find((f) => f.key === key)!;
  const ordered = (keys: string[]) =>
    keys
      .map(field)
      .filter(
        (f) =>
          f.visible ||
          (copyFrom && ['slug', 'description', 'translation'].includes(f.key)) ||
          (f.key === 'slug' && errors.slug) ||
          (f.key === 'description' && errors.descriptionFa) ||
          (f.key === 'translation' && (errors.nameEn || errors.descriptionEn)),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  function change(patch: Partial<ProductDraft>, paths: string[] = Object.keys(patch)) {
    setValue((old) => {
      if (patch.categoryId && patch.categoryId !== old.categoryId) {
        const previousDefault = templates.find((entry) =>
          entry.defaultCategoryIds.includes(old.categoryId),
        );
        const nextDefault = templates.find((entry) =>
          entry.defaultCategoryIds.includes(patch.categoryId!),
        );
        const allowed = new Set(
          data.categories
            .find((c) => c.id === patch.categoryId)
            ?.attributes.map((a) => a.attributeId) ?? [],
        );
        return {
          ...old,
          ...patch,
          attributes: old.attributes.filter((a) => allowed.has(a.attributeId)),
          variants: old.variants.map((row) => ({
            ...(row.id ? row : withDefaultWarranty(row, nextDefault, previousDefault)),
            attributes: row.attributes.filter((a) => allowed.has(a.attributeId)),
          })),
        };
      }
      return { ...old, ...patch };
    });
    setServerErrors((old) =>
      Object.fromEntries(
        Object.entries(old).filter(
          ([path]) => !paths.some((p) => path === p || path.startsWith(p + '.')),
        ),
      ),
    );
    command.setError(undefined);
  }
  const variantsChanged = useCallback(
    (transform: (old: ProductVariantDraft[]) => ProductVariantDraft[]) => {
      setValue((old) => {
        const before = new Set(old.variants.map((row) => row.key));
        const variants = transform(old.variants).map((row) =>
          !before.has(row.key) && defaultWarranty ? withDefaultWarranty(row, defaultWarranty) : row,
        );
        return { ...old, variants };
      });
      setServerErrors((old) =>
        Object.fromEntries(Object.entries(old).filter(([path]) => !path.startsWith('variants.'))),
      );
    },
    [defaultWarranty],
  );
  const editVariant = useCallback((key: string) => setVariantKey(key), []);
  const variant = value.variants.find((v) => v.key === variantKey);
  const copyCategory =
    copyFrom && value.categoryId === copyFrom.categoryId
      ? data.categories.find((category) => category.id === copyFrom.categoryId)
      : undefined;
  function firstError(next: ProductFieldErrors) {
    const path = Object.keys(next)[0];
    if (!path) return;
    setFocusRequest(null);
    setActiveSection(sectionForError(path));
    const row = /^variants\.([^.]+)\./.exec(path);
    if (row) {
      setVariantKey(row[1]);
      return;
    }
    setFocusRequest({ path });
  }
  function close() {
    if (command.blocked || busy) return;
    if (dirty) {
      setDiscard(true);
      return;
    }
    onClose();
  }
  function copyVariants() {
    if (!copyFrom || !copyCategory || value.variants.length || disabled) return;
    if (!validProductSlug(value.slug) || value.slug === copyFrom.slug) {
      const errors = { slug: 'برای ساخت کد تنوع‌ها، نشانی یکتای مدل جدید را وارد کنید.' };
      setServerErrors((old) => ({ ...old, ...errors }));
      firstError(errors);
      return;
    }
    change({
      variants: copyProductVariantLayout(copyFrom, copyCategory, value.slug, () =>
        crypto.randomUUID(),
      ),
    });
  }
  async function save() {
    if (disabled) return;
    setSubmitted(true);
    const invalid = validateProductDraft(value, data);
    const reusedSlug = copyFrom && value.slug === copyFrom.slug;
    if (reusedSlug) invalid.slug = 'نشانی این کالا باید با کالای مبنا متفاوت باشد.';
    setServerErrors(reusedSlug ? { slug: invalid.slug } : {});
    if (Object.keys(invalid).length) {
      firstError(invalid);
      return;
    }
    try {
      const result = await command.send('save', value.id ?? null, {
        productId: value.id ?? null,
        product: productInput(value),
      });
      if (result.productId) onSaved(result.productId);
    } catch (error) {
      if (error instanceof ApiError) {
        const mapped = productErrorPaths(
          error.fieldErrors,
          value.variants.map((v) => v.key),
        );
        setServerErrors(mapped);
        firstError(mapped);
      }
    }
  }
  async function recover(retry = false) {
    try {
      const result = await (retry ? command.retrySame() : command.recover());
      if (
        result?.kind === 'save' &&
        result.productId &&
        (value.id == null || result.productId === value.id)
      )
        onSaved(result.productId);
    } catch {
      /* The exact command and error remain available. */
    }
  }
  const errorCount = Object.keys(errors).length;
  const sectionErrors = Object.keys(errors).reduce<Partial<Record<EditorSection, number>>>(
    (counts, path) => {
      const id = sectionForError(path);
      counts[id] = (counts[id] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const section = (key: EditorSection, title: string, children: React.ReactNode) => (
    <Box
      component="section"
      key={key}
      role="tabpanel"
      id={tabsId + '-panel-' + key}
      aria-labelledby={tabsId + '-tab-' + key}
      hidden={activeSection !== key}
      sx={{
        p: { xs: 2, md: 3 },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 3,
        bgcolor: 'background.paper',
        minWidth: 0,
      }}
    >
      <Box sx={{ mb: 2.5, pb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography component="h3" variant="subtitle1" sx={{ m: 0, fontWeight: 750 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.8 }}>
          {editorSections.find((entry) => entry.id === key)?.hint}
        </Typography>
      </Box>
      {children}
    </Box>
  );
  return (
    <>
      <DialogTitle
        id="product-editor-title"
        sx={{ px: { xs: 2, md: 3 }, py: 2, bgcolor: 'var(--surface-soft)' }}
      >
        <Stack
          direction="row"
          sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}
        >
          <Stack direction="row" sx={{ minWidth: 0, gap: 1.5, alignItems: 'center' }}>
            <Box
              sx={{
                display: { xs: 'none', sm: 'grid' },
                placeItems: 'center',
                width: 46,
                height: 46,
                borderRadius: 2.5,
                bgcolor: 'action.selected',
                color: 'primary.main',
                flexShrink: 0,
              }}
            >
              <Package size={22} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                component="span"
                variant="subtitle1"
                sx={{ display: 'block', fontWeight: 800, overflowWrap: 'anywhere' }}
              >
                {copyFrom
                  ? 'ساخت کالای مشابه'
                  : item
                    ? 'ویرایش: ' +
                      (item.translations.find((t) => t.locale === 'fa')?.name || item.slug)
                    : 'تعریف کالای جدید'}
              </Typography>
              <Stack direction="row" useFlexGap sx={{ mt: 0.75, gap: 0.75, flexWrap: 'wrap' }}>
                <Chip
                  size="small"
                  label={productStateLabel[value.status]}
                  color={value.status === 'Published' ? 'success' : 'default'}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={value.variants.length.toLocaleString('fa-IR') + ' تنوع'}
                />
              </Stack>
            </Box>
          </Stack>
          <Stack direction="row">
            <IconButton
              disabled={disabled}
              aria-label="مدیریت فیلدهای کالا"
              title="مدیریت فیلدهای کالا"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={19} />
            </IconButton>
            <IconButton disabled={disabled} aria-label="بستن فرم کالا" onClick={close}>
              <X size={21} />
            </IconButton>
          </Stack>
        </Stack>
      </DialogTitle>
      <Tabs
        aria-label="بخش‌های ویرایش کالا"
        value={activeSection}
        onChange={(_, id: EditorSection) => {
          setFocusRequest(null);
          setActiveSection(id);
        }}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{
          px: { xs: 0, md: 2 },
          minHeight: 56,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        {editorSections.map(({ id, label, icon: Icon }) => (
          <Tab
            key={id}
            id={tabsId + '-tab-' + id}
            aria-controls={tabsId + '-panel-' + id}
            value={id}
            icon={<Icon size={17} />}
            iconPosition="start"
            label={
              sectionErrors[id]
                ? label + ' · ' + sectionErrors[id].toLocaleString('fa-IR') + ' خطا'
                : label
            }
            sx={{ minHeight: 52, color: sectionErrors[id] ? 'error.main' : undefined }}
          />
        ))}
      </Tabs>
      <DialogContent
        ref={content}
        dividers
        sx={{ p: { xs: 1.25, md: 2.5 }, bgcolor: 'background.default' }}
      >
        <Stack spacing={1.5}>
          {copyFrom && activeSection === 'identity' && (
            <Alert severity="info">
              <strong>
                مبنا <bdi>{nameOf(copyFrom) || copyFrom.slug}</bdi>
              </strong>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                دسته، برند، مشخصات و توضیحات آماده‌اند. نام و نشانی مدل جدید را وارد کنید و متن‌های
                منتقل‌شده را مرور کنید. تصاویر و شرایط فروش را برای همین مدل تعیین کنید. برای انتقال
                رنگ و ویژگی‌های تنوع، به بخش «تنوع و قیمت» بروید.
              </Typography>
            </Alert>
          )}
          {section(
            'identity',
            'اطلاعات پایهٔ کالا',
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5 }}
            >
              {ordered(['name', 'category', 'brand', 'slug', 'description', 'translation']).map(
                (config) => {
                  const props = { label: config.label, help: config.help, disabled };
                  if (config.key === 'name')
                    return (
                      <ProductTextField
                        key={config.key}
                        {...props}
                        required
                        path="nameFa"
                        value={value.nameFa}
                        error={errors.nameFa}
                        onChange={(e) => change({ nameFa: e.target.value })}
                        slotProps={{ htmlInput: { maxLength: 250 } }}
                      />
                    );
                  if (config.key === 'category' || config.key === 'brand') {
                    const category = config.key === 'category',
                      path = category ? 'categoryId' : 'brandId';
                    return (
                      <ProductTextField
                        key={config.key}
                        {...props}
                        select
                        required
                        path={path}
                        value={value[path]}
                        error={errors[path]}
                        helperText={
                          category
                            ? 'تغییر دسته، ویژگی‌های نامرتبط را فقط از پیش‌نویس کنار می‌گذارد.'
                            : undefined
                        }
                        helpAction={{
                          label: category ? 'افزودن دستهٔ جدید' : 'افزودن برند جدید',
                          onClick: () => setQuick(category ? 'category' : 'brand'),
                        }}
                        onChange={(e) => change({ [path]: e.target.value })}
                      >
                        <MenuItem value="">انتخاب کنید</MenuItem>
                        {(category ? data.categories : data.brands).map((row) => (
                          <MenuItem key={row.id} value={row.id}>
                            {'translations' in row ? nameOf(row) : row.name}
                          </MenuItem>
                        ))}
                      </ProductTextField>
                    );
                  }
                  if (config.key === 'slug')
                    return (
                      <ProductTextField
                        key={config.key}
                        {...props}
                        required
                        path="slug"
                        error={errors.slug}
                        value={value.slug}
                        onChange={(e) => change({ slug: e.target.value })}
                        slotProps={{ htmlInput: { dir: 'ltr', maxLength: 150 } }}
                        helperText="مثال: samsung-galaxy-a10"
                      />
                    );
                  if (config.key === 'description')
                    return (
                      <Box key={config.key} sx={{ gridColumn: '1 / -1' }}>
                        <ProductTextField
                          key={config.key}
                          {...props}
                          path="descriptionFa"
                          error={errors.descriptionFa}
                          value={value.descriptionFa}
                          onChange={(e) => change({ descriptionFa: e.target.value })}
                          multiline
                          minRows={3}
                          slotProps={{ htmlInput: { maxLength: 8000 } }}
                        />
                      </Box>
                    );
                  return (
                    <Box
                      component="details"
                      key={config.key}
                      sx={{
                        gridColumn: '1/-1',
                        p: 1.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                      }}
                    >
                      <Box component="summary" sx={{ cursor: 'pointer', fontSize: 14 }}>
                        {config.label}
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
                        {config.help}
                      </Typography>
                      <Stack spacing={2}>
                        <ProductTextField
                          label="نام انگلیسی"
                          path="nameEn"
                          value={value.nameEn}
                          disabled={disabled}
                          error={errors.nameEn}
                          onChange={(e) => change({ nameEn: e.target.value })}
                          slotProps={{ htmlInput: { dir: 'ltr', maxLength: 250 } }}
                        />
                        <ProductTextField
                          label="توضیح انگلیسی"
                          path="descriptionEn"
                          value={value.descriptionEn}
                          disabled={disabled}
                          error={errors.descriptionEn}
                          multiline
                          minRows={3}
                          onChange={(e) => change({ descriptionEn: e.target.value })}
                          slotProps={{ htmlInput: { dir: 'ltr', maxLength: 8000 } }}
                        />
                      </Stack>
                    </Box>
                  );
                },
              )}
            </Box>,
          )}
          {section(
            'specifications',
            field('specifications').label,
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {field('specifications').help}
              </Typography>
              {!value.categoryId ? (
                <Alert severity="info">
                  ابتدا دستهٔ کالا را انتخاب کنید تا فیلدهای مربوط به آن نمایش داده شوند.
                </Alert>
              ) : (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' },
                    gap: 2,
                  }}
                >
                  {[...(data.categories.find((c) => c.id === value.categoryId)?.attributes ?? [])]
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((rule) => {
                      const definition = data.attributes.find((a) => a.id === rule.attributeId);
                      return definition ? (
                        <ProductAttributeField
                          key={rule.attributeId}
                          definition={definition}
                          disabled={disabled}
                          value={value.attributes.find((a) => a.attributeId === rule.attributeId)}
                          path={'attribute.' + rule.attributeId}
                          error={errors['attribute.' + rule.attributeId]}
                          required={rule.isRequired && value.status === 'Published'}
                          help={
                            definition.key === 'insurance'
                              ? 'پوشش مشترک کالا، کنار گارانتی در فروشگاه نمایش داده می‌شود. برای یک تنوع می‌توانید پوشش جداگانه انتخاب کنید.'
                              : undefined
                          }
                          onChange={(next) =>
                            change(
                              {
                                attributes: replaceValue(value.attributes, rule.attributeId, next),
                              },
                              ['attribute.' + rule.attributeId],
                            )
                          }
                        />
                      ) : null;
                    })}
                </Box>
              )}
              <Button
                disabled={disabled}
                onClick={() => setSettings(true)}
                sx={{ alignSelf: 'flex-start' }}
              >
                افزودن ویژگی یا تنظیم مشخصات این دسته
              </Button>
            </Stack>,
          )}
          {section(
            'variants',
            'تنوع‌ها و قیمت فروش',
            <Stack spacing={2}>
              {defaultWarranty && (
                <Alert
                  severity="info"
                  action={
                    <Button
                      disabled={disabled}
                      onClick={() =>
                        variantsChanged((rows) =>
                          rows.map((row) =>
                            row.id ? row : withDefaultWarranty(row, defaultWarranty),
                          ),
                        )
                      }
                    >
                      پرکردن تنوع‌های تازه
                    </Button>
                  }
                >
                  گارانتی پیش‌فرض دسته: {defaultWarranty.nameFa}
                </Alert>
              )}
              {copyFrom &&
                copyCategory &&
                copyFrom.variants.length > 0 &&
                value.variants.length === 0 && (
                  <Alert severity="info">
                    <Typography variant="body2">
                      ترکیب رنگ و ویژگی‌های تنوع را بگیرید و قیمت مدل جدید را جداگانه تعیین کنید.
                      کدهای پیشنهادی از نشانی جدید ساخته می‌شوند و قابل ویرایش‌اند.
                    </Typography>
                    <Button
                      disabled={disabled}
                      onClick={copyVariants}
                      sx={{ minHeight: 44, mt: 0.5 }}
                    >
                      انتقال {copyFrom.variants.length.toLocaleString('fa-IR')} ترکیب تنوع
                    </Button>
                  </Alert>
                )}
              <ProductVariantsTable
                active={activeSection === 'variants'}
                rows={value.variants}
                errors={errors}
                fields={configuration.fields}
                disabled={disabled}
                onChange={variantsChanged}
                onEdit={editVariant}
                onGenerate={() => setGenerator(true)}
              />
            </Stack>,
          )}
          {section(
            'media',
            'تصاویر و ویدیو',
            <Stack spacing={2}>
              <ProductField
                label={field('images').label}
                help={field('images').help}
                path="images"
                error={errors.images}
              >
                {() => (
                  <Box
                    sx={{
                      p: 1,
                      border: errors.images ? '1px solid' : 'none',
                      borderColor: 'error.main',
                      borderRadius: 2,
                    }}
                  >
                    <ImageEditor
                      value={value.imageUrls}
                      disabled={command.blocked || videoBusy}
                      onBusy={setImageBusy}
                      onChange={(urls) => change({ imageUrls: urls }, ['images'])}
                    />
                    {errors.images && (
                      <Typography color="error" variant="caption">
                        {errors.images}
                      </Typography>
                    )}
                  </Box>
                )}
              </ProductField>
              {(field('videos').visible || Boolean(errors.videos)) && (
                <ProductField
                  label={field('videos').label}
                  help={field('videos').help}
                  path="videos"
                  error={errors.videos}
                >
                  {() => (
                    <Box>
                      <ProductVideos
                        value={value.videos}
                        onChange={(next) => change({ videos: next })}
                        disabled={command.blocked || imageBusy}
                        onBusy={setVideoBusy}
                        variants={value.variants}
                      />
                      {errors.videos && (
                        <Typography variant="body2" color="error">
                          {errors.videos}
                        </Typography>
                      )}
                    </Box>
                  )}
                </ProductField>
              )}
            </Stack>,
          )}
          {section(
            'sales',
            'انتشار و روش‌های خرید',
            <Stack spacing={2.5}>
              <Box
                sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}
              >
                <ProductTextField
                  label="وضعیت نمایش کالا"
                  path="status"
                  error={errors.status}
                  select
                  value={value.status}
                  disabled={disabled || Boolean(copyFrom)}
                  help={
                    copyFrom
                      ? 'بعد از ذخیره و بازکردن پیش‌نویس جدید، می‌توانید وضعیت نمایش آن را تغییر دهید.'
                      : 'پیش‌نویس در فروشگاه دیده نمی‌شود. انتشار نیازمند تصویر، تنوع فعال و مشخصات لازم است؛ موجودی از انبار تأمین می‌شود.'
                  }
                  onChange={(e) => change({ status: e.target.value as Product['status'] })}
                >
                  <MenuItem value="Draft">پیش‌نویس</MenuItem>
                  <MenuItem value="Published">منتشرشده</MenuItem>
                  <MenuItem value="Hidden">پنهان</MenuItem>
                </ProductTextField>
                <Stack>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={value.featured}
                        disabled={disabled}
                        onChange={(e) => change({ featured: e.target.checked })}
                      />
                    }
                    label="نمایش در کالاهای منتخب"
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={value.isDigital}
                        disabled={disabled}
                        onChange={(e) => change({ isDigital: e.target.checked })}
                      />
                    }
                    label="کالای دیجیتال بدون ارسال فیزیکی"
                  />
                </Stack>
              </Box>
              <ProductField
                label={field('purchaseMethods').label}
                help={field('purchaseMethods').help}
                path="purchaseMethods"
                error={errors.purchaseMethods}
              >
                {() => (
                  <Box>
                    {methods.map((method) => (
                      <FormControlLabel
                        key={method.id}
                        control={
                          <Checkbox
                            checked={value.purchaseMethodIds.includes(method.id)}
                            disabled={
                              disabled ||
                              (!method.enabled && !value.purchaseMethodIds.includes(method.id))
                            }
                            onChange={(e) =>
                              change(
                                {
                                  purchaseMethodIds: e.target.checked
                                    ? [...value.purchaseMethodIds, method.id]
                                    : value.purchaseMethodIds.filter((id) => id !== method.id),
                                },
                                ['purchaseMethods'],
                              )
                            }
                          />
                        }
                        label={method.nameFa + (!method.enabled ? ' (غیرفعال در فروشگاه)' : '')}
                      />
                    ))}
                    {errors.purchaseMethods && (
                      <Typography color="error" variant="body2">
                        {errors.purchaseMethods}
                      </Typography>
                    )}
                  </Box>
                )}
              </ProductField>
              {methods.some(
                (m) => m.kind === 'cheque' && value.purchaseMethodIds.includes(m.id),
              ) && (
                <ProductTextField
                  label="طرح‌های چکی قابل انتخاب"
                  path="chequePlanIds"
                  error={errors.chequePlanIds}
                  select
                  value={value.chequePlanIds}
                  disabled={disabled}
                  slotProps={{ select: { multiple: true } }}
                  help="فقط طرح‌های فعال در خرید قابل استفاده‌اند؛ خاموش‌بودن روش چکی آن را در فروشگاه پنهان می‌کند."
                  onChange={(e) =>
                    change({
                      chequePlanIds:
                        typeof e.target.value === 'string'
                          ? e.target.value.split(',')
                          : e.target.value,
                    })
                  }
                >
                  {plans.map((plan) => (
                    <MenuItem key={plan.id} value={plan.id}>
                      {plan.nameFa + (!plan.enabled ? ' (غیرفعال)' : '')}
                    </MenuItem>
                  ))}
                </ProductTextField>
              )}
              <Alert
                severity="info"
                action={
                  onInventory ? (
                    <Button
                      disabled={disabled}
                      startIcon={<Warehouse size={16} />}
                      onClick={onInventory}
                    >
                      رفتن به انبار
                    </Button>
                  ) : undefined
                }
              >
                تعریف کالا و قیمت، موجودی ایجاد نمی‌کند. پس از ذخیره، دریافت کالا، موجودی هر SKU،
                سریال و گردش‌ها در انبار مدیریت می‌شوند.
              </Alert>
            </Stack>,
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexDirection: 'column', alignItems: 'stretch', px: 3, py: 2, gap: 1 }}>
        {command.error instanceof Error && <Alert severity="error">{command.error.message}</Alert>}
        {errorCount > 0 && (
          <Alert
            severity="error"
            action={<Button onClick={() => firstError(errors)}>رفتن به اولین خطا</Button>}
          >
            {errorCount.toLocaleString('fa-IR')} فیلد نیاز به اصلاح دارد؛ خطا کنار هر فیلد مشخص شده
            است.
          </Alert>
        )}
        {command.attempt?.phase === 'unknown' && (
          <Alert
            severity="warning"
            action={
              <Stack direction="row">
                <Button disabled={command.reading} onClick={() => void recover()}>
                  بررسی رسید
                </Button>
                <Button onClick={() => void recover(true)}>تکرار همان تلاش</Button>
              </Stack>
            }
          >
            پاسخ ثبت دریافت نشد؛ تغییر تازه نفرستید. بررسی یا تکرار، فقط شناسه و محتوای همان تلاش را
            استفاده می‌کند.
          </Alert>
        )}
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}
        >
          <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
            <Button disabled={disabled} onClick={close}>
              انصراف
            </Button>
            {dirty && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: { xs: 'none', sm: 'block' } }}
              >
                تغییرات ذخیره نشده
              </Typography>
            )}
          </Stack>
          <Button
            variant="contained"
            disabled={disabled}
            startIcon={
              command.attempt?.phase === 'pending' ? (
                <CircularProgress size={17} color="inherit" />
              ) : (
                <Save size={18} />
              )
            }
            onClick={() => void save()}
          >
            {command.attempt?.phase === 'pending'
              ? 'در حال ذخیره…'
              : value.status === 'Published'
                ? 'ذخیره و انتشار کالا'
                : 'ذخیرهٔ ' + (value.status === 'Draft' ? 'پیش‌نویس' : 'کالا')}
          </Button>
        </Stack>
      </DialogActions>
      {quick && (
        <ProductQuickCreate
          kind={quick}
          data={data}
          onClose={() => setQuick(null)}
          onCreated={(id) => {
            change(quick === 'category' ? { categoryId: id } : { brandId: id });
            setQuick(null);
          }}
        />
      )}
      {settings && (
        <ProductFormSettings
          data={data}
          viewerId={viewerId}
          initialCategoryId={value.categoryId}
          onClose={() => setSettings(false)}
        />
      )}
      {generator && (
        <ProductVariantGenerator
          definitions={data.attributes.filter((a) =>
            data.categories
              .find((c) => c.id === value.categoryId)
              ?.attributes.some((rule) => rule.attributeId === a.id && rule.isVariantAxis),
          )}
          current={value.variants}
          prefix={value.slug || 'SKU'}
          shared={value.attributes}
          onClose={() => setGenerator(false)}
          onApply={(rows) => {
            variantsChanged((old) => [...old, ...rows]);
            setGenerator(false);
          }}
        />
      )}
      {variant && (
        <VariantDetails
          key={variant.key}
          value={variant}
          data={data}
          categoryId={value.categoryId}
          warranties={categoryWarranties}
          methods={methods}
          errors={errors}
          disabled={disabled}
          fields={configuration.fields}
          onChange={(patch) =>
            variantsChanged((old) =>
              old.map((v) => (v.key === variant.key ? { ...v, ...patch } : v)),
            )
          }
          onClose={() => setVariantKey(null)}
        />
      )}
      {discard && (
        <Dialog open maxWidth="xs" onClose={() => setDiscard(false)}>
          <DialogTitle>تغییرهای کالا ذخیره نشده‌اند</DialogTitle>
          <DialogContent>
            با بستن فرم، تغییرهای همین کالا کنار گذاشته می‌شوند. تصویرهای آپلودشده در کتابخانه باقی
            می‌مانند.
          </DialogContent>
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
function VariantDetails({
  value,
  data,
  categoryId,
  warranties,
  methods,
  errors,
  fields,
  disabled,
  onChange,
  onClose,
}: {
  value: ProductVariantDraft;
  data: Catalog;
  categoryId: string;
  warranties: WarrantyTemplate[];
  methods: PurchaseMethod[];
  errors: ProductFieldErrors;
  fields: FormFieldsConfiguration['fields'];
  disabled: boolean;
  onChange: (patch: Partial<ProductVariantDraft>) => void;
  onClose: () => void;
}) {
  const root = 'variants.' + value.key + '.';
  const content = useRef<HTMLDivElement | null>(null),
    initialError = useRef(Object.keys(errors).find((path) => path.startsWith(root)));
  useEffect(() => {
    if (initialError.current)
      requestAnimationFrame(() => focusField(content.current, initialError.current!));
  }, []);
  const field = (key: string) => fields.find((f) => f.key === key)!;
  const config = (key: string) => ({ label: field(key).label, help: field(key).help });
  const variantFields = (
    data.categories.find((c) => c.id === categoryId)?.attributes ?? []
  ).flatMap((rule) => {
    const definition = data.attributes.find((a) => a.id === rule.attributeId);
    return definition && (rule.isVariantAxis || definition.key === 'insurance') ? [definition] : [];
  });
  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose} aria-labelledby="variant-details-title">
      <DialogTitle id="variant-details-title">جزئیات تنوع {value.sku || 'جدید'}</DialogTitle>
      <DialogContent dividers ref={content}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
          <ProductTextField
            {...config('sku')}
            path={root + 'sku'}
            value={value.sku}
            error={errors[root + 'sku']}
            disabled={disabled}
            onChange={(e) => onChange({ sku: e.target.value })}
          />
          <ProductTextField
            label="عنوان کوتاه تنوع"
            help="مثلاً حافظه۱۲۸گیگابایت / مشکی؛ در انتخاب تنوع فروشگاه دیده می‌شود."
            path={root + 'labelFa'}
            value={value.labelFa}
            disabled={disabled}
            onChange={(e) => onChange({ labelFa: e.target.value })}
          />
          <ProductTextField
            {...config('price')}
            path={root + 'price'}
            value={value.price}
            error={errors[root + 'price']}
            disabled={disabled}
            onChange={(e) => onChange({ price: e.target.value })}
            slotProps={{ htmlInput: { inputMode: 'decimal', dir: 'ltr' } }}
          />
          {(field('discount').visible ||
            Boolean(value.referencePrice) ||
            Boolean(errors[root + 'referencePrice'])) && (
            <ProductTextField
              {...config('discount')}
              path={root + 'referencePrice'}
              value={value.referencePrice}
              error={errors[root + 'referencePrice']}
              disabled={disabled}
              onChange={(e) => onChange({ referencePrice: e.target.value })}
              slotProps={{ htmlInput: { inputMode: 'decimal', dir: 'ltr' } }}
            />
          )}
          {(field('color').visible || Boolean(errors[root + 'color'])) && (
            <>
              <ProductTextField
                {...config('color')}
                path={root + 'colorNameFa'}
                value={value.colorNameFa}
                disabled={disabled}
                onChange={(e) => onChange({ colorNameFa: e.target.value })}
              />
              <ProductTextField
                label="کد رنگ"
                help="کد HEX شش‌رقمی برای نشان‌دادن رنگ واقعی؛ مثل #151515."
                path={root + 'color'}
                value={value.color}
                error={errors[root + 'color']}
                disabled={disabled}
                onChange={(e) => onChange({ color: e.target.value })}
                slotProps={{ htmlInput: { dir: 'ltr', maxLength: 7 } }}
              />
            </>
          )}
          {(field('warranty').visible || Boolean(errors[root + 'warrantyFa'])) && (
            <Stack spacing={1.5}>
              {warranties.length > 0 && (
                <ProductTextField
                  label="انتخاب از گارانتی‌های دسته"
                  help="انتخاب الگو متن گارانتی این تنوع را پر می‌کند. پس از انتخاب می‌توانید متن را ویرایش کنید."
                  path={root + 'warrantyTemplate'}
                  value=""
                  select
                  disabled={disabled}
                  onChange={(event) => {
                    const selected = warranties.find((entry) => entry.id === event.target.value);
                    if (selected) onChange(warrantyFields(selected));
                  }}
                >
                  <MenuItem value="">انتخاب الگو</MenuItem>
                  {warranties.map((entry) => (
                    <MenuItem key={entry.id} value={entry.id}>
                      {entry.nameFa}
                    </MenuItem>
                  ))}
                </ProductTextField>
              )}
              <ProductTextField
                {...config('warranty')}
                path={root + 'warrantyFa'}
                value={value.warrantyFa}
                multiline
                minRows={2}
                disabled={disabled}
                onChange={(e) => onChange({ warrantyFa: e.target.value })}
              />
              <ProductTextField
                label="گارانتی انگلیسی"
                path={root + 'warrantyEn'}
                value={value.warrantyEn}
                multiline
                minRows={2}
                disabled={disabled}
                onChange={(e) => onChange({ warrantyEn: e.target.value })}
              />
            </Stack>
          )}
          {variantFields.map((definition) => (
            <ProductAttributeField
              key={definition.id}
              definition={definition}
              disabled={disabled}
              value={value.attributes.find((a) => a.attributeId === definition.id)}
              path={root + 'attribute.' + definition.id}
              error={errors[root + 'attribute.' + definition.id]}
              help={
                definition.key === 'insurance'
                  ? 'اگر خالی بماند، بیمهٔ تعریف‌شده برای کالای مادر نمایش داده می‌شود.'
                  : undefined
              }
              onChange={(next) =>
                onChange({ attributes: replaceValue(value.attributes, definition.id, next) })
              }
            />
          ))}
          <Box sx={{ gridColumn: '1/-1' }}>
            <ProductTextField
              label="محدودیت روش خرید این تنوع"
              help="خالی یعنی روش‌های کالای مادر؛ با انتخاب، این تنوع فقط روش‌های مشترک با کالای مادر را دارد."
              path={root + 'purchaseMethods'}
              error={errors[root + 'purchaseMethods']}
              select
              value={value.purchaseMethodIds}
              slotProps={{ select: { multiple: true } }}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  purchaseMethodIds:
                    typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value,
                })
              }
            >
              {methods.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.nameFa}
                </MenuItem>
              ))}
            </ProductTextField>
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={value.isActive}
                disabled={disabled}
                onChange={(e) => onChange({ isActive: e.target.checked })}
              />
            }
            label="این تنوع قابل نمایش باشد"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>بازگشت به جدول</Button>
      </DialogActions>
    </Dialog>
  );
}
