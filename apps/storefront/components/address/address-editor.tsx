'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { Check, MapPin, Navigation, UserRound, X } from 'lucide-react';
import { Button } from '../shared/ui';
import './address-map.css';
import {
  saveAddressInput,
  savedDelivery,
  type SavedAddress,
  type SaveAddressInput,
} from '@/lib/address/address-contract';
import {
  cities,
  counties,
  provinces,
  findCity,
  findCounty,
  findProvince,
  geographyVersion,
  geographySearch,
  resolveLegacyLocation,
  countyMapCenter,
} from '@/lib/address/address-geography';

const AddressMap = dynamic(() => import('./address-map'), {
  ssr: false,
});

export function AddressEditor({
  locale,
  value,
  disabled,
  onSave,
  onCancel,
}: {
  locale: 'fa' | 'en';
  value: SavedAddress | null;
  disabled: boolean;
  onSave: (input: SaveAddressInput) => void;
  onCancel: () => void;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, []);
  const legacy = resolveLegacyLocation(value?.delivery.province ?? '', value?.delivery.city ?? '');
  const [values, setValues] = useState({
    label: value?.label ?? '',
    contactName: value?.contactName ?? '',
    contactPhone: value?.contactPhone ?? '',
    address: value?.delivery.address ?? '',
    postalCode: value?.delivery.postalCode ?? '',
    provinceId: value?.details?.provinceId ?? legacy.provinceId,
    countyId: value?.details?.countyId ?? legacy.countyId,
    cityId: value?.details?.cityId ?? legacy.cityId,
    otherCity: value?.delivery.city ?? '',
    localityKind: value?.details?.localityKind ?? (legacy.cityId || !value ? 'city' : 'other'),
    plaque: value?.details?.plaque ?? '',
    unit: value?.details?.unit ?? '',
    makeDefault: false,
  });
  const [point, setPoint] = useState<[number, number] | null>(
    value?.details?.latitude != null && value.details.longitude != null
      ? [value.details.latitude, value.details.longitude]
      : null,
  );
  const [showMap, setShowMap] = useState(false),
    [search, setSearch] = useState(''),
    [editingArea, setEditingArea] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const province = findProvince(values.provinceId),
    county = findCounty(values.countyId),
    city = findCity(values.cityId),
    manualLocality = savedDelivery.shape.city.safeParse(values.otherCity);
  const validLocality = Boolean(
    province &&
    county?.provinceId === province.id &&
    (values.localityKind === 'city'
      ? city?.provinceId === province.id && city.countyId === county.id
      : values.localityKind === 'other' && manualLocality.success),
  );
  const localityName =
    values.localityKind === 'city' ? city?.name : manualLocality.success ? manualLocality.data : '';
  const localitySummary = validLocality
    ? [province?.name, county?.name, localityName]
        .filter((name, index, names) => name && names.indexOf(name) === index)
        .join('، ')
    : '';
  const enteredAddress = [
    values.address.trim(),
    values.plaque.trim() ? text('پلاک ', 'Plaque ') + values.plaque.trim() : '',
    values.unit.trim() ? text('واحد ', 'Unit ') + values.unit.trim() : '',
  ]
    .filter(Boolean)
    .join('، ');
  const regionErrors = errors.some((key) =>
    ['provinceId', 'countyId', 'cityId', 'city'].includes(key),
  );
  const showAreaEditor = !point || !validLocality || editingArea || regionErrors;
  const errorMessages: Record<string, string> = {
    label: text('یک عنوان کوتاه، تا ۶۰ نویسه بنویسید.', 'Use an address label of 1–60 characters.'),
    contactName: text(
      'نام و نام خانوادگی گیرنده، ۲ تا ۱۰۰ نویسه.',
      'Use a recipient name of 2–100 characters.',
    ),
    contactPhone: text(
      'شمارهٔ همراه معتبر ایران، مانند ۰۹۱۲۱۲۳۴۵۶۷.',
      'Enter an Iranian mobile, e.g. 09121234567.',
    ),
    provinceId: text('استان را از فهرست انتخاب کنید.', 'Choose a province.'),
    countyId: text('شهرستانِ همین استان را انتخاب کنید.', 'Choose a county in this province.'),
    cityId: text('شهرِ همین شهرستان را انتخاب کنید.', 'Choose a city in this county.'),
    city: text(
      'نام شهر، روستا یا محل را کامل بنویسید.',
      'Enter the city, village or locality name.',
    ),
    address: text(
      'خیابان، کوچه و جزئیات مسیر را بین ۱۰ تا ۲۰۰۰ نویسه بنویسید.',
      'Use 10–2,000 characters for the street and delivery details.',
    ),
    postalCode: text('کد پستی باید دقیقاً ۱۰ رقم باشد.', 'Enter exactly 10 postal-code digits.'),
    plaque: text(
      'پلاک را بنویسید؛ اگر ندارد «بدون پلاک» وارد کنید (تا ۲۰ نویسه).',
      'Enter a plaque, or “No plaque”, up to 20 characters.',
    ),
    unit: text('واحد باید حداکثر ۱۰ نویسه باشد.', 'Use up to 10 characters for the unit.'),
    latitude: text(
      'نقطهٔ معتبر در محدودهٔ ایران انتخاب کنید.',
      'Select a valid point within Iran.',
    ),
  };
  function change(key: keyof typeof values, next: string | boolean) {
    if (disabled) return;
    setValues((v) => ({ ...v, [key]: next }));
    if (key === 'otherCity') {
      setPoint(null);
      setShowMap(false);
    }
    const errorKey = key === 'otherCity' ? 'city' : key;
    setErrors((v) =>
      v.filter((e) => (key === 'localityKind' ? e !== 'city' && e !== 'cityId' : e !== errorKey)),
    );
  }
  function focusDetails() {
    if (disabled) return;
    requestAnimationFrame(() => {
      const target = form.current?.querySelector<HTMLElement>(
        !province
          ? '#address-provinceId'
          : !county || county.provinceId !== province.id
            ? '#address-countyId'
            : values.localityKind === 'city' &&
                (!city || city.provinceId !== province.id || city.countyId !== county.id)
              ? '#address-cityId'
              : values.localityKind === 'other' && !manualLocality.success
                ? '#address-city'
                : '#address-address',
      );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  }
  function editArea() {
    if (disabled) return;
    setEditingArea(true);
    requestAnimationFrame(() => {
      const target = form.current?.querySelector<HTMLElement>('#address-provinceId');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  }
  function feedback(key: string) {
    return errors.includes(key) ? (
      <small id={`address-${key}-error`} className="field-error">
        {errorMessages[key]}
      </small>
    ) : null;
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const parsed = saveAddressInput.safeParse({
      label: values.label,
      contactName: values.contactName,
      contactPhone: values.contactPhone,
      delivery: {
        countryCode: 'IR',
        province: findProvince(values.provinceId)?.name ?? '',
        city:
          values.localityKind === 'city' ? (findCity(values.cityId)?.name ?? '') : values.otherCity,
        address: values.address,
        postalCode: values.postalCode,
      },
      makeDefault: values.makeDefault,
      version: value?.version ?? null,
      details: {
        geographyVersion,
        provinceId: values.provinceId,
        countyId: values.countyId,
        cityId: values.localityKind === 'city' ? values.cityId : null,
        localityKind: values.localityKind,
        plaque: values.plaque,
        unit: values.unit,
        latitude: point?.[0] ?? null,
        longitude: point?.[1] ?? null,
      },
    });
    if (!parsed.success) {
      const next = [
        ...new Set(
          parsed.error.issues.map((issue) => {
            const key = String(issue.path.at(-1));
            if (issue.path[0] === 'delivery' && key === 'province') return 'provinceId';
            if (issue.path[0] === 'delivery' && key === 'city')
              return values.localityKind === 'city' ? 'cityId' : 'city';
            return key;
          }),
        ),
      ];
      setErrors(next);
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setErrors([]);
    onSave(parsed.data);
  }
  const availableCounties = counties
    .filter((v) => v.provinceId === values.provinceId)
    .sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  const availableCities = cities
    .filter((v) => v.countyId === values.countyId)
    .sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  // Always retain the selected option when a search is edited.
  const filteredCities = availableCities.filter(
    (v) => v.id === values.cityId || geographySearch(v.name).includes(geographySearch(search)),
  );
  return (
    <section className="address-editor" aria-labelledby="address-editor-title">
      <div className="address-editor-heading">
        <div>
          <span className="eyebrow">{text('محل تحویل بعدی شما', 'Your next delivery')}</span>
          <h2 id="address-editor-title" ref={heading} tabIndex={-1}>
            {value
              ? text('ویرایش نشانی', 'Edit address')
              : text('افزودن نشانی تازه', 'Add a new address')}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          aria-label={text('بستن فرم نشانی', 'Close address form')}
          onClick={() => {
            if (!disabled) onCancel();
          }}
        >
          <X size={20} />
        </Button>
      </div>
      <form ref={form} onSubmit={submit} noValidate>
        {errors.length > 0 && (
          <p role="alert" className="field-error">
            {text('فیلدهای مشخص‌شده را بررسی کنید.', 'Check the highlighted fields.')}
          </p>
        )}
        <fieldset className="address-form-section" disabled={disabled}>
          <legend>
            <UserRound size={18} />
            {text('۱. گیرنده و عنوان نشانی', '1. Recipient and address label')}
          </legend>
          <div
            className="address-label-presets"
            aria-label={text('عنوان‌های پیشنهادی', 'Suggested labels')}
          >
            {[text('خانه', 'Home'), text('محل کار', 'Work'), text('خانواده', 'Family')].map(
              (label) => (
                <button
                  type="button"
                  key={label}
                  aria-pressed={values.label === label}
                  onClick={() => change('label', label)}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <div className="form-grid">
            {(
              [
                [
                  'label',
                  text('عنوان نشانی', 'Address label'),
                  'off',
                  60,
                  'text',
                  text('مثلاً خانهٔ من', 'e.g. My home'),
                ],
                [
                  'contactName',
                  text('نام و نام خانوادگی گیرنده', 'Recipient full name'),
                  'name',
                  100,
                  'text',
                  '',
                ],
                [
                  'contactPhone',
                  text('همراه گیرنده', 'Recipient mobile'),
                  'tel',
                  64,
                  'tel',
                  '۰۹۱۲۱۲۳۴۵۶۷',
                ],
              ] as const
            ).map(([key, label, auto, max, inputMode, placeholder]) => (
              <div className={`field address-field-${key}`} key={key}>
                <label htmlFor={`address-${key}`}>
                  {label} <span aria-hidden="true">*</span>
                </label>
                <input
                  id={`address-${key}`}
                  name={key}
                  required
                  autoComplete={auto}
                  value={values[key]}
                  maxLength={max}
                  inputMode={inputMode}
                  dir={key === 'contactPhone' ? 'ltr' : undefined}
                  placeholder={placeholder}
                  aria-invalid={errors.includes(key)}
                  aria-describedby={errors.includes(key) ? `address-${key}-error` : undefined}
                  onChange={(e) => change(key, e.target.value)}
                />
                {feedback(key)}
              </div>
            ))}
          </div>
        </fieldset>
        <fieldset className="address-form-section" disabled={disabled}>
          <legend>
            <MapPin size={18} />
            {text('۲. محدوده و نشانی تحویل', '2. Area and delivery address')}
          </legend>
          {showAreaEditor && (
            <div id="address-area-controls" className="address-area-controls">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="address-provinceId">{text('استان', 'Province')} *</label>
                  <select
                    id="address-provinceId"
                    name="provinceId"
                    required
                    autoComplete="address-level1"
                    value={values.provinceId}
                    aria-invalid={errors.includes('provinceId')}
                    aria-describedby={
                      errors.includes('provinceId') ? 'address-provinceId-error' : undefined
                    }
                    onChange={(e) => {
                      if (disabled) return;
                      setValues({
                        ...values,
                        provinceId: e.target.value,
                        countyId: '',
                        cityId: '',
                        otherCity: '',
                      });
                      setPoint(null);
                      setShowMap(false);
                      setSearch('');
                      if (findProvince(e.target.value))
                        setErrors((v) => v.filter((key) => key !== 'provinceId'));
                    }}
                  >
                    <option value="">{text('انتخاب استان', 'Choose province')}</option>
                    {[...provinces]
                      .sort((a, b) => a.name.localeCompare(b.name, 'fa'))
                      .map((v) => (
                        <option value={v.id} key={v.id}>
                          {v.name}
                        </option>
                      ))}
                  </select>
                  {feedback('provinceId')}
                </div>
                <div className="field">
                  <label htmlFor="address-countyId">{text('شهرستان', 'County')} *</label>
                  <select
                    id="address-countyId"
                    name="countyId"
                    required
                    disabled={!values.provinceId}
                    value={values.countyId}
                    aria-invalid={errors.includes('countyId')}
                    aria-describedby={
                      errors.includes('countyId') ? 'address-countyId-error' : undefined
                    }
                    onChange={(e) => {
                      if (disabled) return;
                      setValues({ ...values, countyId: e.target.value, cityId: '', otherCity: '' });
                      setPoint(null);
                      setShowMap(false);
                      setSearch('');
                      if (availableCounties.some((county) => county.id === e.target.value))
                        setErrors((v) => v.filter((key) => key !== 'countyId'));
                    }}
                  >
                    <option value="">
                      {values.provinceId
                        ? text('انتخاب شهرستان', 'Choose county')
                        : text('ابتدا استان را انتخاب کنید', 'Choose province first')}
                    </option>
                    {availableCounties.map((v) => (
                      <option value={v.id} key={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  {feedback('countyId')}
                </div>
              </div>
              <div className="field">
                {values.localityKind === 'city' ? (
                  <>
                    <label htmlFor="address-cityId">{text('شهر', 'City')} *</label>
                    {availableCities.length > 8 && (
                      <input
                        type="search"
                        className="address-city-search"
                        aria-label={text(
                          'جست‌وجو در شهرهای شهرستان',
                          'Search cities in this county',
                        )}
                        placeholder={text('جست‌وجوی نام شهر…', 'Search city…')}
                        value={search}
                        maxLength={100}
                        onChange={(e) => {
                          if (!disabled) setSearch(e.target.value);
                        }}
                      />
                    )}
                    <select
                      id="address-cityId"
                      name="cityId"
                      required
                      autoComplete="address-level2"
                      disabled={!values.countyId}
                      value={values.cityId}
                      aria-invalid={errors.includes('cityId')}
                      aria-describedby={
                        errors.includes('cityId') ? 'address-cityId-error' : undefined
                      }
                      onChange={(e) => {
                        if (disabled) return;
                        change('cityId', e.target.value);
                        setPoint(null);
                        setShowMap(false);
                      }}
                    >
                      <option value="">
                        {values.countyId
                          ? text('انتخاب شهر', 'Choose city')
                          : text('ابتدا شهرستان را انتخاب کنید', 'Choose county first')}
                      </option>
                      {filteredCities.map((v) => (
                        <option value={v.id} key={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    {feedback('cityId')}
                    {search && filteredCities.length === 0 && (
                      <small role="status">
                        {text('شهری با این نام پیدا نشد.', 'No city found.')}
                      </small>
                    )}
                  </>
                ) : (
                  <>
                    <label htmlFor="address-city">
                      {text('نام شهر، روستا یا محل', 'City, village or locality')} *
                    </label>
                    <input
                      id="address-city"
                      name="city"
                      required
                      value={values.otherCity}
                      maxLength={100}
                      autoComplete="address-level2"
                      aria-invalid={errors.includes('city')}
                      aria-describedby={errors.includes('city') ? 'address-city-error' : undefined}
                      onChange={(e) => change('otherCity', e.target.value)}
                    />
                    {feedback('city')}
                    <small>
                      {text(
                        'نام این محل دستی ثبت می‌شود؛ صحت آن در فهرست جغرافیایی تأیید نشده است.',
                        'This locality is entered manually and has not been verified against the list.',
                      )}
                    </small>
                  </>
                )}
                <button
                  type="button"
                  className="text-link address-locality-toggle"
                  onClick={() => {
                    if (disabled) return;
                    change('localityKind', values.localityKind === 'city' ? 'other' : 'city');
                    setPoint(null);
                    setShowMap(false);
                  }}
                >
                  {values.localityKind === 'city'
                    ? text('روستا یا محل من در فهرست نیست', 'My village or locality is not listed')
                    : text('انتخاب شهر از فهرست', 'Choose a city from the list')}
                </button>
              </div>
            </div>
          )}
          {validLocality && (
            <section
              className="address-confirmed-location"
              aria-label={text('نشانی واردشده', 'Entered address')}
            >
              <div className="address-confirmed-location-heading">
                <MapPin size={20} aria-hidden="true" />
                <div>
                  <span className="address-confirmed-location-label">
                    {text('محدودهٔ تحویل', 'Delivery area')}
                  </span>
                  <strong className="address-confirmed-location-name">{localitySummary}</strong>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="address-confirmed-location-edit"
                  disabled={disabled}
                  aria-expanded={showAreaEditor}
                  aria-controls="address-area-controls"
                  onClick={editArea}
                >
                  {text('ویرایش محدوده', 'Edit area')}
                </Button>
              </div>
              <div className="address-confirmed-location-details">
                <span className="address-confirmed-location-label">
                  {text('نشانی واردشده', 'Entered address')}
                </span>
                <p className="address-confirmed-location-address">
                  {enteredAddress ||
                    text(
                      'خیابان و جزئیات ساختمان هنوز وارد نشده است.',
                      'Street and building details have not been entered yet.',
                    )}
                </p>
                <p className="address-confirmed-location-postal">
                  <span>{text('کد پستی:', 'Postal code:')}</span>{' '}
                  {values.postalCode.trim() ? (
                    <bdi dir="ltr">{values.postalCode.trim()}</bdi>
                  ) : (
                    <span>{text('وارد نشده', 'Not entered')}</span>
                  )}
                </p>
              </div>
            </section>
          )}
          <div className="field">
            <label htmlFor="address-address">
              {text('خیابان، کوچه و جزئیات تحویل', 'Street and delivery details')} *
            </label>
            <textarea
              id="address-address"
              name="address"
              required
              value={values.address}
              maxLength={2000}
              rows={3}
              autoComplete="street-address"
              placeholder={text(
                'نام خیابان، کوچه، ساختمان و راهنمای تحویل',
                'Street, building and delivery instructions',
              )}
              aria-invalid={errors.includes('address')}
              aria-describedby={errors.includes('address') ? 'address-address-error' : undefined}
              onChange={(e) => change('address', e.target.value)}
            />
            {feedback('address')}
          </div>
          <div className="form-grid address-building-grid">
            {(['plaque', 'unit', 'postalCode'] as const).map((key) => (
              <div className="field" key={key}>
                <label htmlFor={`address-${key}`}>
                  {key === 'plaque'
                    ? text('پلاک', 'Plaque')
                    : key === 'unit'
                      ? text('واحد (اختیاری)', 'Unit (optional)')
                      : text('کد پستی ۱۰ رقمی', '10-digit postal code')}
                  {key !== 'unit' && ' *'}
                </label>
                <input
                  id={`address-${key}`}
                  name={key}
                  required={key !== 'unit'}
                  value={values[key]}
                  maxLength={key === 'postalCode' ? 64 : key === 'plaque' ? 20 : 10}
                  inputMode={key === 'postalCode' ? 'numeric' : 'text'}
                  dir={key === 'postalCode' ? 'ltr' : undefined}
                  autoComplete={key === 'postalCode' ? 'postal-code' : 'off'}
                  aria-invalid={errors.includes(key)}
                  aria-describedby={errors.includes(key) ? `address-${key}-error` : undefined}
                  onChange={(e) => change(key, e.target.value)}
                />
                {feedback(key)}
              </div>
            ))}
          </div>
          <p className="small-note">
            {text(
              'فرمت کد پستی و همراه بررسی می‌شود؛ تطبیق نشانی با سامانهٔ پست یا مالکیت شماره تأیید نمی‌شود.',
              'Postal and mobile formats are checked; postal delivery and phone ownership are not verified.',
            )}
          </p>
        </fieldset>
        <fieldset className="address-form-section address-location-section" disabled={disabled}>
          <legend>
            <Navigation size={18} />
            {text('۳. موقعیت روی نقشه', '3. Map location')}{' '}
            <small>{text('اختیاری', 'optional')}</small>
          </legend>
          <div className="address-location-choices">
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              aria-expanded={showMap}
              onClick={() => {
                if (!disabled) setShowMap(!showMap);
              }}
            >
              <MapPin size={17} />
              {showMap
                ? text('بستن نقشه', 'Close map')
                : point
                  ? text('مشاهده و تغییر نقطه', 'View or edit point')
                  : text('انتخاب از روی نقشه', 'Choose on map')}
            </Button>
            <Button type="button" variant="ghost" disabled={disabled} onClick={focusDetails}>
              {text('ورود دستی نشانی', 'Enter address manually')}
            </Button>
          </div>
          {showMap && (
            <AddressMap
              locale={locale}
              center={countyMapCenter(values.countyId)}
              point={point}
              disabled={disabled}
              presentation="compact"
              summary={localitySummary}
              onManual={focusDetails}
              onContinue={focusDetails}
              onChange={(next, area) => {
                if (disabled) return;
                if (area) {
                  const nextProvince = findProvince(area.provinceId),
                    nextCounty = findCounty(area.countyId),
                    nextCity = area.cityId ? findCity(area.cityId) : undefined;
                  if (
                    !nextProvince ||
                    nextCounty?.provinceId !== nextProvince.id ||
                    !nextCity ||
                    nextCity.provinceId !== nextProvince.id ||
                    nextCity.countyId !== nextCounty.id
                  )
                    return;
                  setValues((current) => ({
                    ...current,
                    provinceId: area.provinceId,
                    countyId: area.countyId,
                    cityId: area.cityId ?? '',
                    localityKind: 'city',
                    otherCity: '',
                  }));
                  setSearch('');
                  setErrors((current) =>
                    current.filter(
                      (key) =>
                        !['provinceId', 'countyId', 'cityId', 'city', 'latitude'].includes(key),
                    ),
                  );
                }
                setPoint(next);
                setEditingArea(false);
                setErrors((current) => current.filter((key) => key !== 'latitude'));
              }}
            />
          )}
          {point && (
            <div className="address-point-status" role="status">
              <Check size={16} />
              <span>
                {text('نقطهٔ تحویل روی نقشه تأیید شد', 'Delivery point confirmed')}{' '}
                {!validLocality && (
                  <bdi>
                    {point[0].toFixed(6)}, {point[1].toFixed(6)}
                  </bdi>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setPoint(null);
                  setShowMap(false);
                }}
              >
                {text('حذف نقطه', 'Remove point')}
              </Button>
            </div>
          )}
          {feedback('latitude')}
        </fieldset>
        <div className="address-editor-footer">
          <label className="check-label">
            <input
              type="checkbox"
              disabled={disabled || value?.isDefault}
              checked={value?.isDefault || values.makeDefault}
              onChange={(e) => change('makeDefault', e.target.checked)}
            />
            {text('نشانی پیش‌فرض برای خریدهای بعدی', 'Default address for future purchases')}
          </label>
          <p className="small-note">
            {text(
              'اولین نشانی خودکار پیش‌فرض می‌شود. تغییر این فرم، نشانی سفارش‌های قبلی را عوض نمی‌کند.',
              'Your first address becomes the default. Existing order addresses are unchanged.',
            )}
          </p>
          <div className="order-action-row">
            <Button type="submit" disabled={disabled}>
              {text('ذخیرهٔ نشانی', 'Save address')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                if (!disabled) onCancel();
              }}
            >
              {text('انصراف', 'Cancel')}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
