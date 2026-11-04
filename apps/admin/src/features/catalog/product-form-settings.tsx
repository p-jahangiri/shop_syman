import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { Settings2, Plus } from 'lucide-react';
import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';
import { api, ApiError } from '../../api/api';
import { ProductTextField } from './product-editor-fields';
import { ProductQuickCreate } from './product-quick-create';
import { useProductCommand } from '../../hooks/use-product-command';
import {
  productWorkspaceBase,
  readFormFields,
  type FormFieldsConfiguration,
} from '../../api/contracts/catalog/product-workspace-contract';
import {
  nameOf,
  type Catalog,
  type Category,
  type CategoryAttribute,
  type AttributeDefinition,
} from '../../types/types';

export function ProductFormSettings({
  data,
  viewerId,
  initialCategoryId,
  onClose,
}: {
  data: Catalog;
  viewerId: string;
  initialCategoryId?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(0),
    [presentationDirty, setPresentationDirty] = useState(false),
    [categoryDirty, setCategoryDirty] = useState(false),
    [discard, setDiscard] = useState(false);
  const command = useProductCommand(viewerId);
  function close() {
    if (command.blocked) return;
    if (presentationDirty || categoryDirty) setDiscard(true);
    else onClose();
  }
  const query = useQuery({
    queryKey: ['admin', 'product-form-fields'],
    queryFn: async ({ signal }) =>
      readFormFields(await api<unknown>(productWorkspaceBase + '/fields', { signal })),
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <Dialog open maxWidth="lg" onClose={close} aria-labelledby="product-form-settings-title">
      <DialogTitle id="product-form-settings-title">
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: 2.5,
              color: 'info.main',
              bgcolor: 'var(--admin-primary-soft)',
            }}
          >
            <Settings2 size={21} />
          </Box>
          <Box>
            <span>مدیریت فیلدهای کالا</span>
            <Typography variant="body2" color="text.secondary">
              فرم ثبت، مشخصات، فیلترهای فروشگاه و محورهای تنوع
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <Tabs
        value={tab}
        onChange={(_, value: number) => setTab(value)}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        <Tab label="عنوان و راهنمای فرم" />
        <Tab label="ویژگی‌ها و تنوع‌های هر دسته" />
      </Tabs>
      <DialogContent dividers>
        <Box hidden={tab !== 0}>
          {query.isPending ? (
            <CircularProgress aria-label="دریافت تنظیمات فیلدها" />
          ) : query.error ? (
            <Alert
              severity="error"
              action={<Button onClick={() => void query.refetch()}>تلاش دوباره</Button>}
            >
              {query.error.message}
            </Alert>
          ) : query.data ? (
            <FieldPresentationEditor
              value={query.data}
              viewerId={viewerId}
              onDirty={setPresentationDirty}
            />
          ) : null}
        </Box>
        <Box hidden={tab !== 1}>
          <CategoryFieldsEditor
            data={data}
            initialId={initialCategoryId}
            onDirty={setCategoryDirty}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button disabled={command.blocked} onClick={close}>
          بازگشت به کالا
        </Button>
      </DialogActions>
      {discard && (
        <Dialog open maxWidth="xs" onClose={() => setDiscard(false)}>
          <DialogTitle>تنظیمات فرم ذخیره نشده‌اند</DialogTitle>
          <DialogContent>
            با بستن تنظیمات، تغییرهای ذخیره‌نشده کنار گذاشته می‌شوند؛ پیش‌نویس کالا حفظ می‌شود.
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDiscard(false)}>ادامهٔ ویرایش</Button>
            <Button color="error" onClick={onClose}>
              بستن بدون ذخیره
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Dialog>
  );
}
function FieldPresentationEditor({
  value,
  viewerId,
  onDirty,
}: {
  value: FormFieldsConfiguration;
  viewerId: string;
  onDirty: (value: boolean) => void;
}) {
  const [rows, setRows] = useState(value.fields),
    [version, setVersion] = useState(value.version);
  const [search, setSearch] = useState('');
  const term = normalizePersian(search);
  const visible = rows.filter((row) => normalizePersian(row.label + ' ' + row.help).includes(term));
  const command = useProductCommand(viewerId),
    [saved, setSaved] = useState(false);
  function change(key: string, patch: Partial<FormFieldsConfiguration['fields'][number]>) {
    onDirty(true);
    setSaved(false);
    setRows((old) => old.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  async function save() {
    try {
      const result = await command.send(
        'fields',
        null,
        {
          version,
          fields: rows.map(({ key, label, help, visible, sortOrder }) => ({
            key,
            label,
            help,
            visible,
            sortOrder,
          })),
        },
        'fields',
        'PUT',
      );
      setVersion(result.productVersion);
      setRows((old) =>
        old.map((row) => ({ ...row, label: row.label.trim(), help: row.help.trim() })),
      );
      setSaved(true);
      onDirty(false);
    } catch {
      /* The command banner retains errors and the exact recovery id. */
    }
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        عنوان، توضیح راهنما، ترتیب و نمایش فیلدهای اختیاری را تنظیم کنید. فیلدهای اصلی برای صحت کالا
        همیشه نمایش داده می‌شوند؛ اجباری‌بودن مشخصات هر دسته در تب کناری تعیین می‌شود.
      </Alert>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        useFlexGap
        sx={{ alignItems: { sm: 'center' } }}
      >
        <TextField
          label="جست‌وجوی عنوان یا راهنما"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Chip
          label={visible.length.toLocaleString('fa-IR') + ' فیلد'}
          color="info"
          variant="outlined"
        />
      </Stack>
      {visible.length === 0 && (
        <Typography color="text.secondary">فیلدی با این عبارت پیدا نشد.</Typography>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        {visible.map((row) => (
          <Box
            key={row.key}
            sx={{
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 3,
              bgcolor: 'var(--surface-soft)',
            }}
          >
            <Stack spacing={1.5}>
              <ProductTextField
                label="عنوان فیلد"
                path={'settings.' + row.key + '.label'}
                help="این عنوان در فرم تعریف کالا دیده می‌شود؛ داده و نوع ویژگی را تغییر نمی‌دهد."
                disabled={command.blocked}
                value={row.label}
                error={!row.label.trim() ? 'عنوان فیلد نمی‌تواند خالی باشد.' : undefined}
                onChange={(e) => change(row.key, { label: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 150 } }}
              />
              <ProductTextField
                label="متن راهنما"
                path={'settings.' + row.key + '.help'}
                help="توضیح کوتاه و کاربردی کنار آیکون سؤال همین فیلد."
                disabled={command.blocked}
                value={row.help}
                multiline
                minRows={2}
                onChange={(e) => change(row.key, { help: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
              />
              <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
                <TextField
                  type="number"
                  label="ترتیب"
                  value={row.sortOrder}
                  disabled={command.blocked}
                  onChange={(e) => change(row.key, { sortOrder: Number(e.target.value) })}
                  slotProps={{ htmlInput: { min: 0, max: 1000 } }}
                  sx={{ maxWidth: 100 }}
                />
                <Checkbox
                  checked={row.visible}
                  disabled={row.visibilityLocked || command.blocked}
                  onChange={(e) => change(row.key, { visible: e.target.checked })}
                  slotProps={{ input: { 'aria-label': 'نمایش ' + row.label } }}
                />
                <Typography variant="body2">
                  {row.visibilityLocked ? 'فیلد اصلی' : 'نمایش در فرم'}
                </Typography>
              </Stack>
            </Stack>
          </Box>
        ))}
      </Box>
      {command.error instanceof Error && <Alert severity="error">{command.error.message}</Alert>}
      {command.attempt?.phase === 'unknown' && (
        <Alert
          severity="warning"
          action={
            <Stack direction="row">
              <Button disabled={command.reading} onClick={() => void command.recover()}>
                بررسی رسید
              </Button>
              <Button onClick={() => void command.retrySame().catch(() => {})}>
                تکرار همان تلاش
              </Button>
            </Stack>
          }
        >
          نتیجهٔ ذخیره نامشخص است؛ تغییر تازه نفرستید.
        </Alert>
      )}
      {saved && <Alert severity="success">تنظیمات فرم ذخیره شد. اطلاعات کالا تغییر نکرد.</Alert>}
      <Button
        variant="contained"
        disabled={
          command.blocked ||
          rows.some(
            (r) =>
              !r.label.trim() ||
              !Number.isInteger(r.sortOrder) ||
              r.sortOrder < 0 ||
              r.sortOrder > 1000,
          )
        }
        onClick={() => void save()}
      >
        ذخیرهٔ تنظیمات فرم
      </Button>
    </Stack>
  );
}
function CategoryFieldsEditor({
  data,
  initialId,
  onDirty,
}: {
  data: Catalog;
  initialId?: string;
  onDirty: (value: boolean) => void;
}) {
  const client = useQueryClient();
  const [category, setCategory] = useState<Category | undefined>(() =>
    data.categories.find((c) => c.id === initialId),
  );
  const [rules, setRules] = useState<CategoryAttribute[]>(
    () => category?.attributes.map((a) => ({ ...a })) ?? [],
  );
  const [adding, setAdding] = useState(''),
    [quick, setQuick] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [changed, setChanged] = useState(false);
  const [editingAttribute, setEditingAttribute] = useState<AttributeDefinition | undefined>();
  const [pendingCategory, setPendingCategory] = useState<Category | undefined | null>(null);
  const [search, setSearch] = useState('');
  function loadCategory(next: Category | undefined) {
    setCategory(next);
    setRules(next?.attributes.map((a) => ({ ...a })) ?? []);
    setSearch('');
    setChanged(false);
    onDirty(false);
    setError('');
    setSaved(false);
  }
  function select(next: Category | undefined) {
    if (next?.id === category?.id) return;
    if (changed) setPendingCategory(next);
    else loadCategory(next);
  }
  function update(id: string, patch: Partial<CategoryAttribute>) {
    onDirty(true);
    setChanged(true);
    setSaved(false);
    setRules((old) => old.map((row) => (row.attributeId === id ? { ...row, ...patch } : row)));
  }
  function add(id: string) {
    if (!id || rules.some((r) => r.attributeId === id)) return;
    setRules((old) => [
      ...old,
      {
        attributeId: id,
        isRequired: false,
        isFilterable: true,
        isComparable: true,
        showInSpecs: true,
        isVariantAxis: false,
        sortOrder: old.length * 10,
        groupName: 'general',
      },
    ]);
    onDirty(true);
    setChanged(true);
    setSaved(false);
    setAdding('');
  }
  async function save() {
    if (!category) return;
    setBusy(true);
    setError('');
    try {
      await api('/admin/categories/' + category.id, {
        method: 'PUT',
        body: JSON.stringify({
          slug: category.slug,
          parentId: category.parentId ?? null,
          imageUrl: category.imageUrl,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          version: category.version,
          translations: category.translations.map(({ locale, name, description }) => ({
            locale,
            name,
            description,
          })),
          attributes: rules.map(
            ({
              attributeId,
              isRequired,
              isFilterable,
              isComparable,
              showInSpecs,
              isVariantAxis,
              sortOrder,
              groupName,
            }) => ({
              attributeId,
              isRequired,
              isFilterable,
              isComparable,
              showInSpecs,
              isVariantAxis,
              sortOrder,
              groupName,
            }),
          ),
        }),
      });
      const refreshed = await api<Catalog>('/admin/catalog?metadataOnly=true');
      const fresh = refreshed.categories.find((c) => c.id === category.id);
      if (!fresh) throw new Error('پاسخ دسته پس از ثبت قابل تأیید نیست.');
      setCategory(fresh);
      setRules(fresh.attributes.map((a) => ({ ...a })));
      setChanged(false);
      onDirty(false);
      setSaved(true);
      await client.invalidateQueries({ queryKey: ['admin'] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'ذخیره انجام نشد.');
      if (failure instanceof ApiError && failure.status >= 500)
        setError(
          'نتیجهٔ ذخیره مشخص نیست؛ نسخهٔ دسته را از سرور بازخوانی و با تغییرهای خود مقایسه کنید.',
        );
    } finally {
      setBusy(false);
    }
  }
  const visibleRules = [...rules]
    .filter((rule) =>
      normalizePersian(
        nameOf(data.attributes.find((a) => a.id === rule.attributeId)) + ' ' + rule.groupName,
      ).includes(normalizePersian(search)),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        برای هر دسته تعیین کنید چه مشخصاتی لازم‌اند، کدام ویژگی تنوع می‌سازد و ترتیب و گروه نمایش
        چیست. ویژگی «چند گزینه‌ای» محور یک SKU نیست. این تغییر، مقدار مشخصات کالاهای موجود را
        بازنویسی نمی‌کند.
      </Alert>
      <ProductTextField
        label="دستهٔ موردنظر"
        path="settings.category"
        help="قواعد هر دسته مستقل‌اند؛ مثلاً حافظه برای گوشی و ظرفیت/نوع اتصال برای لوازم جانبی."
        select
        value={category?.id ?? ''}
        disabled={busy}
        onChange={(e) => select(data.categories.find((c) => c.id === e.target.value))}
      >
        <MenuItem value="">انتخاب دسته</MenuItem>
        {data.categories.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {nameOf(c)}
          </MenuItem>
        ))}
      </ProductTextField>
      {category && (
        <>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            useFlexGap
            sx={{ alignItems: { sm: 'center' } }}
          >
            <TextField
              label="جست‌وجوی ویژگی‌های این دسته"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Chip
              label={
                rules.filter((rule) => rule.isVariantAxis).length.toLocaleString('fa-IR') +
                ' محور تنوع'
              }
              color="secondary"
              variant="outlined"
            />
          </Stack>
          {visibleRules.length === 0 && (
            <Typography color="text.secondary">
              {rules.length ? 'ویژگی منطبق پیدا نشد.' : 'هنوز ویژگی‌ای به این دسته اضافه نشده است.'}
            </Typography>
          )}
          {visibleRules.map((rule) => {
            const definition = data.attributes.find((a) => a.id === rule.attributeId);
            return (
              <Box
                key={rule.attributeId}
                sx={{
                  p: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 3,
                  bgcolor: 'var(--surface-soft)',
                }}
              >
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {nameOf(definition)}
                  {definition?.unit ? ' · ' + definition.unit : ''}
                  <Button
                    size="small"
                    disabled={busy || !definition}
                    onClick={() => {
                      setEditingAttribute(definition);
                      setQuick(true);
                    }}
                  >
                    ویرایش عنوان و گزینه‌ها
                  </Button>
                </Typography>
                <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                  {(
                    [
                      { key: 'isRequired', label: 'اجباری' },
                      { key: 'isVariantAxis', label: 'محور تنوع' },
                      { key: 'isFilterable', label: 'فیلتر فروشگاه' },
                      { key: 'isComparable', label: 'قابل مقایسه' },
                      { key: 'showInSpecs', label: 'نمایش مشخصات' },
                    ] as const
                  ).map((item) => (
                    <Box
                      component="label"
                      key={item.key}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        bgcolor: rule[item.key] ? 'var(--admin-primary-soft)' : 'var(--surface)',
                        paddingInlineEnd: 1,
                        cursor: 'pointer',
                      }}
                    >
                      <Checkbox
                        checked={rule[item.key]}
                        color={
                          item.key === 'isVariantAxis'
                            ? 'secondary'
                            : item.key === 'isFilterable'
                              ? 'info'
                              : 'primary'
                        }
                        disabled={
                          busy ||
                          (item.key === 'isVariantAxis' && definition?.dataType === 'MultiSelect')
                        }
                        onChange={(e) => update(rule.attributeId, { [item.key]: e.target.checked })}
                        slotProps={{
                          input: { 'aria-label': item.label + ' ' + nameOf(definition) },
                        }}
                      />
                      <Typography variant="body2">{item.label}</Typography>
                    </Box>
                  ))}
                  <TextField
                    disabled={busy}
                    label="گروه"
                    value={rule.groupName}
                    onChange={(e) => update(rule.attributeId, { groupName: e.target.value })}
                    sx={{ maxWidth: 160 }}
                  />
                  <TextField
                    disabled={busy}
                    label="ترتیب"
                    type="number"
                    value={rule.sortOrder}
                    onChange={(e) =>
                      update(rule.attributeId, { sortOrder: Number(e.target.value) })
                    }
                    sx={{ maxWidth: 90 }}
                  />
                </Stack>
              </Box>
            );
          })}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <ProductTextField
              label="افزودن ویژگی موجود به دسته"
              path="settings.add-attribute"
              help="از ویژگی‌های تعریف‌شده انتخاب کنید یا ویژگی تازه با گزینه‌های دلخواه بسازید."
              select
              value={adding}
              disabled={busy}
              onChange={(e) => {
                setAdding(e.target.value);
                add(e.target.value);
              }}
            >
              <MenuItem value="">انتخاب ویژگی</MenuItem>
              {data.attributes
                .filter((a) => !rules.some((r) => r.attributeId === a.id))
                .map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {nameOf(a)}
                  </MenuItem>
                ))}
            </ProductTextField>
            <Button
              disabled={busy}
              startIcon={<Plus size={16} />}
              onClick={() => {
                setEditingAttribute(undefined);
                setQuick(true);
              }}
            >
              ساخت ویژگی جدید
            </Button>
          </Stack>
          {error && (
            <Alert
              severity="error"
              action={
                <Button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void api<Catalog>('/admin/catalog?metadataOnly=true')
                      .then((refreshed) => {
                        const fresh = refreshed.categories.find((c) => c.id === category.id);
                        if (!fresh) throw new Error('دسته پیدا نشد.');
                        setCategory(fresh);
                        setRules(fresh.attributes.map((a) => ({ ...a })));
                        setChanged(false);
                        onDirty(false);
                        setError('');
                      })
                      .catch((failure) =>
                        setError(
                          failure instanceof Error ? failure.message : 'بازخوانی انجام نشد.',
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  بارگذاری نسخهٔ فعلی
                </Button>
              }
            >
              {error}
            </Alert>
          )}
          {saved && <Alert severity="success">قواعد ویژگی‌های دسته ذخیره شد.</Alert>}
          <Button variant="contained" disabled={busy || !changed} onClick={() => void save()}>
            {busy ? 'در حال ذخیره…' : 'ذخیرهٔ ویژگی‌های این دسته'}
          </Button>
        </>
      )}
      {quick && (
        <ProductQuickCreate
          kind="attribute"
          key={editingAttribute?.id ?? 'new'}
          item={editingAttribute}
          data={data}
          onClose={() => setQuick(false)}
          onCreated={(id) => {
            setQuick(false);
            add(id);
          }}
        />
      )}
      {pendingCategory !== null && (
        <Dialog open maxWidth="xs" onClose={() => setPendingCategory(null)}>
          <DialogTitle>تغییرهای ذخیره‌نشده</DialogTitle>
          <DialogContent>
            با تغییر دسته، تغییرهای ذخیره‌نشدهٔ این فهرست کنار گذاشته می‌شوند. فرم کالا تغییری
            نمی‌کند.
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPendingCategory(null)}>بازگشت</Button>
            <Button
              onClick={() => {
                loadCategory(pendingCategory);
                setPendingCategory(null);
              }}
            >
              تغییر دسته
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
