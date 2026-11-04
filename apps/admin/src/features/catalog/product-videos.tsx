import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import { Upload, Trash2, Link as LinkIcon } from 'lucide-react';
import { ProductTextField } from './product-editor-fields';
import { api } from '../../api/api';
import {
  adminVideoUrl,
  validProductVideoUrl,
  uploadedVideoSchema,
  videoCapabilitiesSchema,
  type ProductVideo,
} from '../../api/contracts/catalog/product-video-contract';
import type { ProductVariantDraft } from './product-editor-model';
export function ProductVideos({
  value,
  onChange,
  disabled,
  onBusy,
  variants,
}: {
  value: ProductVideo[];
  onChange: (value: ProductVideo[]) => void;
  disabled: boolean;
  onBusy: (value: boolean) => void;
  variants: ProductVariantDraft[];
}) {
  const capability = useQuery({
    queryKey: ['admin', 'video-capabilities'],
    queryFn: async () =>
      videoCapabilitiesSchema.parse(await api<unknown>('/admin/media/videos/capabilities')),
    retry: false,
    staleTime: 30000,
  });
  const [link, setLink] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const upload = useRef<AbortController | null>(null),
    alive = useRef(true),
    current = useRef(value),
    callbacks = useRef({ onChange, onBusy });
  current.current = value;
  callbacks.current = { onChange, onBusy };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      upload.current?.abort();
      if (upload.current) callbacks.current.onBusy(false);
    };
  }, []);
  async function send(file: File | undefined) {
    if (!file || disabled || upload.current || current.current.length >= 8) return;
    setError('');
    if (!capability.data?.configured) {
      setError(
        'پردازش، اسکن یا ذخیره‌ساز ویدیو آماده نیست؛ می‌توانید لینک مستقیم معتبر اضافه کنید.',
      );
      return;
    }
    if (
      !capability.data.contentTypes.includes(file.type as 'video/mp4' | 'video/webm') ||
      file.size < 12 ||
      file.size > capability.data.maxBytes
    ) {
      setError('فایل MP4 یا WebM تا۳۲مگابایت انتخاب کنید.');
      return;
    }
    const controller = new AbortController();
    upload.current = controller;
    setBusy(true);
    callbacks.current.onBusy(true);
    try {
      const body = new FormData();
      body.set('file', file);
      const result = uploadedVideoSchema.parse(
        await api<unknown>('/admin/media/videos', {
          method: 'POST',
          body,
          signal: controller.signal,
        }),
      );
      if (!alive.current || controller.signal.aborted) return;
      const next = [...current.current, { url: result.url, variantId: null }];
      current.current = next;
      callbacks.current.onChange(next);
    } catch (failure) {
      if (alive.current && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'آپلود ویدیو انجام نشد.');
    } finally {
      upload.current = null;
      if (alive.current) {
        setBusy(false);
        callbacks.current.onBusy(false);
      }
    }
  }
  function add() {
    if (disabled || busy || value.length >= 8) return;
    if (!validProductVideoUrl(link.trim())) {
      setError('لینک مستقیم HTTPS فایل MP4/WebM بدون اطلاعات ورود یا fragment وارد کنید.');
      return;
    }
    if (value.some((v) => v.url === link.trim() && v.variantId === null)) {
      setError('این ویدیو قبلاً اضافه شده است.');
      return;
    }
    onChange([...value, { url: link.trim(), variantId: null }]);
    setLink('');
    setError('');
  }
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        حداکثر ۸ ویدیو، هر فایل تا ۳۲ مگابایت و ۱۰ دقیقه. MP4 با H.264/AAC یا WebM با VP8/VP9.
      </Typography>
      <Alert severity="info">
        برای نمایش ویدیو در فروشگاه، فرم کالا را ذخیره کنید. ویدیوی یک SKU در گالری همان تنوع پخش
        می‌شود. برای نمایش روی همهٔ رنگ‌ها و حافظه‌ها، «همهٔ تنوع‌های کالا» را انتخاب کنید.
      </Alert>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: 'flex-end' }}>
        <ProductTextField
          label="لینک مستقیم ویدیو"
          path="videos.link"
          help="لینک صفحهٔ آپارات/یوتیوب قابل پخش مستقیم نیست؛ نشانی خود فایل MP4/WebM را وارد کنید. لینک بیرونی در سرور دانلود نمی‌شود."
          disabled={disabled || busy || value.length >= 8}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          slotProps={{ htmlInput: { dir: 'ltr', maxLength: 1500 } }}
        />
        <Button
          variant="outlined"
          startIcon={<LinkIcon size={17} />}
          disabled={disabled || busy || value.length >= 8}
          onClick={add}
        >
          افزودن لینک
        </Button>
        <Button
          component="label"
          variant="outlined"
          startIcon={<Upload size={17} />}
          disabled={disabled || busy || value.length >= 8 || !capability.data?.configured}
        >
          آپلود فایل
          <input
            hidden
            type="file"
            accept="video/mp4,video/webm,.mp4,.webm"
            disabled={disabled || busy || !capability.data?.configured}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void send(file);
            }}
          />
        </Button>
      </Stack>
      {capability.data && !capability.data.configured && (
        <Alert severity="info">
          آپلود تا آماده‌شدن ذخیره‌ساز، اسکن و ابزار پردازش غیرفعال است. لینک مستقیم قابل استفاده
          است.
        </Alert>
      )}
      {capability.error && (
        <Alert severity="warning">
          وضعیت آپلود دریافت نشد.
          <Button onClick={() => void capability.refetch()}>تلاش دوباره</Button>
        </Alert>
      )}
      {busy && <Alert severity="info">در حال آپلود، اسکن و آماده‌سازی ویدیو…</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {value.map((video, index) => (
        <Box
          key={video.url + '|' + index}
          sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
        >
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Chip
                label={'ویدیو ' + (index + 1).toLocaleString('fa-IR')}
                size="small"
                color="info"
                variant="outlined"
              />
              <Chip
                label={video.variantId ? 'مختص یک تنوع' : 'مشترک همهٔ تنوع‌ها'}
                size="small"
                color={video.variantId ? 'warning' : 'success'}
                variant="outlined"
              />
            </Stack>
            <Box
              component="video"
              controls
              playsInline
              preload="none"
              src={adminVideoUrl(video.url)}
              aria-label={'ویدیوی کالا ' + (index + 1)}
              sx={{ maxHeight: 240, width: '100%', bgcolor: '#171b16', borderRadius: 1 }}
            />
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <ProductTextField
                label="نمایش ویدیو برای"
                path={'videos.' + index + '.variantId'}
                help="همهٔ تنوع‌ها یا یک SKU مشخص؛ اتصال تنوع جدید پس از ذخیرهٔ اولیه ممکن است."
                select
                disabled={disabled || busy}
                value={video.variantId ?? ''}
                onChange={(e) =>
                  onChange(
                    value.map((v, i) =>
                      i === index ? { ...v, variantId: e.target.value || null } : v,
                    ),
                  )
                }
              >
                <MenuItem value="">همهٔ تنوع‌های کالا</MenuItem>
                {variants
                  .filter((v) => v.id)
                  .map((v) => (
                    <MenuItem key={v.id} value={v.id!}>
                      {v.sku + ' · ' + v.labelFa}
                    </MenuItem>
                  ))}
              </ProductTextField>
              <IconButton
                aria-label={'حذف ویدیو ' + (index + 1) + ' از کالا'}
                disabled={disabled || busy}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Trash2 size={18} />
              </IconButton>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              <bdi>{video.url}</bdi>
            </Typography>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
