'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker, TileEvent } from 'leaflet';
import {
  Check,
  LocateFixed,
  MapPin,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Pencil,
  X,
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import './address-map.css';
import { Button, Modal } from '../shared/ui';
import { cities, findCity, deliveryPoint } from '@/lib/address/address-geography';
import {
  searchAddressLocations,
  type AddressLocationSearchResult,
} from '@/lib/address/address-location-search';

type Point = [number, number];
type Viewport = { center: Point; zoom: number };
const iran: Point = [32.43, 53.68];
const keyOf = (point: Point | null) => point?.map((v) => v.toFixed(6)).join(':') ?? '';
const tileKey = ({ z, x, y }: { z: number; x: number; y: number }) => `${z}/${x}/${y}`;
function initialViewport(point: Point | null, center?: Point): Viewport {
  const selected = point && deliveryPoint(...point) ? point : null;
  const county = center && deliveryPoint(...center) ? center : null;
  return { center: selected ?? county ?? iran, zoom: selected ? 16 : county ? 14 : 5 };
}

export default function AddressMap({
  locale,
  center,
  point,
  disabled,
  onChange,
  onManual,
  onContinue,
  presentation = 'inline',
  summary,
}: {
  locale: 'fa' | 'en';
  center?: Point;
  point: Point | null;
  disabled: boolean;
  onChange: (point: Point, area?: AddressLocationSearchResult) => void;
  onManual?: () => void;
  onContinue?: () => void;
  presentation?: 'inline' | 'compact';
  summary?: string;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const helpId = useId();
  const expandButton = useRef<HTMLButtonElement>(null);
  const closeAction = useRef<'manual' | 'continue' | null>(null);
  const previousCenter = useRef(keyOf(center ?? null));
  const [hostNode, setHostNode] = useState<HTMLDivElement | null>(null);
  // A stable ref also observes the later mount inside the dialog Portal.
  const [connectHost] = useState(() => (node: HTMLDivElement | null) => {
    setHostNode(node);
  });
  const map = useRef<LeafletMap | null>(null);
  const syncPoint = useRef<((value: Point | null) => void) | null>(null);
  const syncInteractions = useRef<(() => void) | null>(null);
  const centerIsLoaded = useRef<(() => boolean) | null>(null);
  const movingNow = useRef(false);
  const latest = useRef({ disabled, onChange, point, readOnly: false });
  const viewport = useRef(initialViewport(point, center));
  const snapshot = useRef<{ viewport: Viewport; pointKey: string } | null>(null);
  const knownPoint = useRef(keyOf(point));
  const ownSelection = useRef<string | null>(null);
  const [view, setView] = useState(() => initialViewport(point, center));
  const [expanded, setExpanded] = useState(presentation === 'compact');
  const [query, setQuery] = useState('');
  const [chosenArea, setChosenArea] = useState<AddressLocationSearchResult | undefined>();
  const readOnly = presentation === 'compact' && !expanded;
  const results = searchAddressLocations(query);
  const searchId = useId();
  const [retry, setRetry] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moving, setMoving] = useState(false);
  const lat = center?.[0],
    lon = center?.[1];

  useEffect(() => {
    latest.current = { disabled, onChange, point, readOnly };
    const nextKey = keyOf(point);
    const nextCenter = keyOf(lat == null || lon == null ? null : [lat, lon]);
    if (previousCenter.current !== nextCenter) {
      previousCenter.current = nextCenter;
      if (ownSelection.current !== nextKey) {
        snapshot.current = null;
        setChosenArea(undefined);
        setQuery('');
        const next = initialViewport(point, lat == null || lon == null ? undefined : [lat, lon]);
        viewport.current = next;
        map.current?.setView(next.center, next.zoom, { animate: false });
      }
    }
    if (knownPoint.current !== nextKey) {
      knownPoint.current = nextKey;
      snapshot.current = null;
      if (ownSelection.current !== nextKey) {
        setChosenArea(undefined);
        setQuery('');
        const next = initialViewport(point, lat == null || lon == null ? undefined : [lat, lon]);
        viewport.current = next;
        map.current?.setView(next.center, next.zoom, { animate: false });
      }
      ownSelection.current = null;
    }
    syncPoint.current?.(point);
    syncInteractions.current?.();
  }, [disabled, onChange, point, lat, lon, readOnly]);

  useEffect(() => {
    if (!hostNode?.isConnected) return;
    let disposed = false;
    let instance: LeafletMap | null = null;
    let observer: ResizeObserver | undefined;
    void import('leaflet')
      .then((L) => {
        if (disposed || !hostNode.isConnected) return;
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const current = L.map(hostNode, {
          zoomControl: false,
          scrollWheelZoom: expanded,
          dragging: !latest.current.disabled && !latest.current.readOnly,
          doubleClickZoom: 'center',
          minZoom: 5,
          maxZoom: 19,
          zoomAnimation: !reduce,
          fadeAnimation: !reduce,
          markerZoomAnimation: !reduce,
          maxBounds: [
            [24, 43.5],
            [40.5, 64],
          ],
          maxBoundsViscosity: 1,
        });
        instance = current;
        map.current = current;
        const loaded = new Set<string>();
        const available = () => {
          if (disposed || !hostNode.isConnected || map.current !== current) return false;
          const zoom = Math.round(current.getZoom());
          const pixel = current.project(current.getCenter(), zoom);
          return loaded.has(
            tileKey({ z: zoom, x: Math.floor(pixel.x / 256), y: Math.floor(pixel.y / 256) }),
          );
        };
        centerIsLoaded.current = available;
        const refresh = () => {
          if (disposed) return;
          const position = current.getCenter();
          const next: Viewport = { center: [position.lat, position.lng], zoom: current.getZoom() };
          viewport.current = next;
          setView((previous) =>
            previous.zoom === next.zoom &&
            previous.center[0] === next.center[0] &&
            previous.center[1] === next.center[1]
              ? previous
              : next,
          );
          setReady(available());
        };
        current.on('movestart zoomstart', () => {
          if (disposed) return;
          movingNow.current = true;
          setMoving(true);
        });
        current.on('moveend zoomend', () => {
          if (disposed) return;
          movingNow.current = false;
          setMoving(false);
          refresh();
        });
        current.on('click', (event) => {
          if (
            disposed ||
            latest.current.disabled ||
            latest.current.readOnly ||
            (event.originalEvent?.detail ?? 1) > 1 ||
            !deliveryPoint(event.latlng.lat, event.latlng.lng)
          )
            return;
          current.panTo(event.latlng, { animate: false });
        });
        current.setView(viewport.current.center, viewport.current.zoom, { animate: false });
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          minZoom: 5,
          maxZoom: 19,
          tileSize: 256,
          zoomOffset: 0,
          detectRetina: false,
          noWrap: true,
          updateWhenIdle: true,
          updateWhenZooming: false,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
          referrerPolicy: 'strict-origin-when-cross-origin',
        });
        tiles.on('loading', () => {
          if (!disposed) {
            setFailed(false);
            setReady(available());
          }
        });
        tiles.on('tileload', (event: TileEvent) => {
          if (disposed || !event.tile.isConnected) return;
          loaded.add(tileKey(event.coords));
          setReady(available());
        });
        tiles.on('tileerror', (event: TileEvent) => {
          if (disposed || !event.tile.isConnected) return;
          loaded.delete(tileKey(event.coords));
          setFailed(true);
          setReady(available());
        });
        const removeLoadedTile = (event: TileEvent) => {
          if (disposed) return;
          // tileunload is emitted after detaching the image, so always remove it.
          loaded.delete(tileKey(event.coords));
          setReady(available());
        };
        tiles.on('tileunload', removeLoadedTile).on('tileabort', removeLoadedTile);
        tiles.addTo(current);
        L.control.scale({ imperial: false, maxWidth: 90, updateWhenIdle: true }).addTo(current);
        let selectedMarker: Marker | null = null;
        const icon = L.divIcon({
          className: 'address-map-saved-marker',
          html: '<span aria-hidden="true"></span>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        syncPoint.current = (value) => {
          if (disposed) return;
          if (!value || !deliveryPoint(...value)) {
            selectedMarker?.remove();
            selectedMarker = null;
          } else if (selectedMarker) selectedMarker.setLatLng(value);
          else
            selectedMarker = L.marker(value, { icon, keyboard: false, interactive: false }).addTo(
              current,
            );
        };
        syncPoint.current(latest.current.point);
        syncInteractions.current = () => {
          const enabled = !latest.current.disabled && !latest.current.readOnly;
          for (const handler of [
            current.dragging,
            current.touchZoom,
            current.doubleClickZoom,
            current.keyboard,
            current.boxZoom,
          ]) {
            if (enabled) handler.enable();
            else handler.disable();
          }
          if (enabled && expanded) current.scrollWheelZoom.enable();
          else current.scrollWheelZoom.disable();
        };
        syncInteractions.current();
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => {
            if (!disposed) current.invalidateSize({ pan: false });
          });
          observer.observe(hostNode);
        }
        current.invalidateSize({ pan: false });
        setInitialized(true);
        refresh();
      })
      .catch(() => {
        if (!disposed) {
          setFailed(true);
          setReady(false);
        }
      });
    return () => {
      disposed = true;
      observer?.disconnect();
      instance?.remove();
      if (map.current === instance) {
        map.current = null;
        syncPoint.current = null;
        syncInteractions.current = null;
        centerIsLoaded.current = null;
        movingNow.current = false;
      }
    };
  }, [hostNode, expanded, retry]);

  function resetAvailability() {
    setInitialized(false);
    setReady(false);
    setFailed(false);
    setMoving(false);
    movingNow.current = false;
  }
  function navigate(next: Viewport) {
    if (latest.current.disabled || !deliveryPoint(...next.center)) return;
    viewport.current = next;
    setView(next);
    setReady(false);
    map.current?.setView(next.center, next.zoom, { animate: false });
  }
  function openLarge() {
    if (latest.current.disabled) return;
    closeAction.current = null;
    snapshot.current = { viewport: viewport.current, pointKey: keyOf(latest.current.point) };
    setChosenArea(undefined);
    setQuery('');
    resetAvailability();
    setExpanded(true);
  }
  function cancelLarge() {
    closeAction.current = null;
    const previous = snapshot.current;
    viewport.current =
      previous?.pointKey === keyOf(latest.current.point)
        ? previous.viewport
        : initialViewport(latest.current.point, center);
    snapshot.current = null;
    setChosenArea(undefined);
    setQuery('');
    resetAvailability();
    setExpanded(false);
  }
  function confirm() {
    const current = map.current;
    if (
      !current ||
      chosenArea?.kind === 'county' ||
      latest.current.disabled ||
      movingNow.current ||
      !centerIsLoaded.current?.() ||
      current.getZoom() < 14
    )
      return;
    const location = current.getCenter();
    if (!deliveryPoint(location.lat, location.lng)) return;
    const next: Point = [Number(location.lat.toFixed(6)), Number(location.lng.toFixed(6))];
    ownSelection.current = keyOf(next);
    viewport.current = { center: next, zoom: current.getZoom() };
    latest.current.onChange(next, chosenArea);
    if (expanded) {
      closeAction.current = 'continue';
      setChosenArea(undefined);
      setQuery('');
      snapshot.current = null;
      resetAvailability();
      setExpanded(false);
    }
  }
  const canConfirm =
    !disabled &&
    initialized &&
    chosenArea?.kind !== 'county' &&
    ready &&
    !moving &&
    view.zoom >= 14 &&
    deliveryPoint(...view.center);
  const selected = point && keyOf(point) === keyOf(view.center) && !moving;
  const guide = text(
    'نقشه را بکشید تا محل تحویل زیر نشانگر قرار بگیرد.',
    'Drag the map to put the delivery location under the pin.',
  );
  const picker = (
    <div className="address-map-picker">
      {expanded && (
        <div className="address-map-search">
          <label htmlFor={searchId} className="sr-only">
            {text('جست‌وجوی استان، شهرستان یا شهر', 'Search province, county or city')}
          </label>
          <div className="address-map-search-input">
            <Search size={20} aria-hidden="true" />
            <input
              id={searchId}
              type="search"
              value={query}
              maxLength={100}
              autoComplete="off"
              placeholder={text(
                'جست‌وجوی استان، شهرستان یا شهر…',
                'Search province, county or city…',
              )}
              disabled={disabled}
              aria-describedby={`${searchId}-hint`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
                if (event.key === 'Escape' && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery('');
                }
              }}
            />
            {query && (
              <button
                type="button"
                disabled={disabled}
                aria-label={text('پاک‌کردن جست‌وجو', 'Clear search')}
                onClick={() => setQuery('')}
              >
                <X size={18} />
              </button>
            )}
          </div>
          <small id={`${searchId}-hint`}>
            {text('محدودهٔ موردنظر را انتخاب کنید.', 'Choose the area you want to view.')}
          </small>
          {query.trim() && (
            <div
              className="address-map-search-results"
              aria-label={text('نتایج جست‌وجوی محل', 'Location search results')}
            >
              {results.length ? (
                <ul>
                  {results.map((area) => (
                    <li key={area.key}>
                      <button
                        type="button"
                        disabled={disabled || !area.center}
                        onClick={() => {
                          if (latest.current.disabled || !area.center) return;
                          setChosenArea(area);
                          setQuery('');
                          navigate({ center: area.center, zoom: 14 });
                        }}
                      >
                        <MapPin size={18} aria-hidden="true" />
                        <span>
                          <strong>{area.name}</strong>
                          <small>
                            {area.path.join(' · ')}
                            {!area.center &&
                              text(' — مرکز نقشه در دسترس نیست', ' — map center unavailable')}
                          </small>
                        </span>
                        <small>
                          {area.kind === 'city' ? text('شهر', 'City') : text('شهرستان', 'County')}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p role="status">
                  {text(
                    'محلی پیدا نشد؛ نام استان یا شهرستان را امتحان کنید یا دستی وارد کنید.',
                    'No area found. Try a province or county, or enter the address manually.',
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {expanded && chosenArea && (
        <p className="address-map-area" role="status">
          <MapPin size={16} />
          <span>
            {chosenArea.path.join(' · ')}
            <small>
              {text(
                'مرکز تقریبی شهرستان؛ نقطهٔ دقیق تحویل را روی نقشه مشخص کنید.',
                'Approximate county center; place the exact delivery point on the map.',
              )}
            </small>
          </span>
        </p>
      )}
      {expanded && chosenArea?.kind === 'county' && (
        <div className="address-map-city-choice">
          <label htmlFor={`${searchId}-city`}>
            {text('شهر محل تحویل را انتخاب کنید', 'Choose the delivery city')}
          </label>
          <select
            id={`${searchId}-city`}
            value=""
            disabled={disabled}
            onChange={(event) => {
              const city = findCity(event.target.value);
              if (
                latest.current.disabled ||
                !city ||
                city.countyId !== chosenArea.countyId ||
                city.provinceId !== chosenArea.provinceId
              )
                return;
              setChosenArea({
                ...chosenArea,
                kind: 'city',
                key: `city:${city.id}`,
                name: city.name,
                cityId: city.id,
                cityName: city.name,
                path: [chosenArea.provinceName, chosenArea.countyName, city.name].filter(
                  (name, index, names) => names.indexOf(name) === index,
                ),
              });
            }}
          >
            <option value="">
              {text(
                'انتخاب شهر؛ یا ورود دستی برای روستا و محل دیگر',
                'Choose a city, or use manual entry for another locality',
              )}
            </option>
            {cities
              .filter((city) => city.countyId === chosenArea.countyId)
              .map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
          </select>
        </div>
      )}
      <p id={helpId} className="sr-only">
        {text(
          'با کلیدهای جهت نقشه را جابه‌جا کنید؛ + و − برای بزرگ‌نمایی هستند. تأیید نقطه، نشانی را ذخیره نمی‌کند.',
          'Use arrow keys to move and + or − to zoom. Confirming a point does not save the address.',
        )}
      </p>
      <div className={`address-map-stage${moving ? ' is-moving' : ''}`}>
        <div
          ref={connectHost}
          className="address-map-surface"
          dir="ltr"
          role="region"
          tabIndex={0}
          aria-label={text('نقشهٔ انتخاب محل تحویل', 'Delivery location map')}
          aria-describedby={helpId}
          aria-busy={!initialized || (!ready && !failed)}
          inert={disabled}
        />
        <div className="address-map-target" aria-hidden="true">
          <MapPin className="address-map-target-pin" size={38} fill="currentColor" />
          <span className="address-map-target-dot" />
        </div>
        <div
          className="address-map-zoom"
          role="group"
          aria-label={text('بزرگ‌نمایی نقشه', 'Map zoom')}
        >
          <button
            className="address-map-zoom-button"
            type="button"
            disabled={disabled || !initialized || view.zoom >= 19}
            aria-label={text('بزرگ‌نمایی', 'Zoom in')}
            onClick={() => {
              if (!latest.current.disabled) map.current?.zoomIn(1, { animate: false });
            }}
          >
            <Plus size={22} />
          </button>
          <button
            className="address-map-zoom-button"
            type="button"
            disabled={disabled || !initialized || view.zoom <= 5}
            aria-label={text('کوچک‌نمایی', 'Zoom out')}
            onClick={() => {
              if (!latest.current.disabled) map.current?.zoomOut(1, { animate: false });
            }}
          >
            <Minus size={22} />
          </button>
        </div>
        {!initialized && !failed && (
          <p className="address-map-loading" role="status">
            {text('در حال دریافت نقشه…', 'Loading map…')}
          </p>
        )}
      </div>
      <div className="address-map-shortcuts">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !initialized}
          onClick={() => navigate(initialViewport(null, chosenArea?.center ?? center))}
        >
          <RotateCcw size={17} />
          {chosenArea?.center || center
            ? text('مرکز شهرستان', 'County center')
            : text('نمای ایران', 'Iran overview')}
        </Button>
        {point && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !initialized}
            onClick={() => {
              setChosenArea(undefined);
              navigate(initialViewport(point, center));
            }}
          >
            <LocateFixed size={17} />
            {text('نقطهٔ انتخاب‌شده', 'Selected point')}
          </Button>
        )}
        {view.zoom < 14 && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !initialized}
            onClick={() => navigate({ center: view.center, zoom: 16 })}
          >
            {text('نمای محله', 'Neighborhood view')}
          </Button>
        )}
      </div>
      {failed && (
        <div className="address-map-warning">
          <p role="status">
            {text(
              'بخشی از نقشه دریافت نشد. دوباره تلاش کنید یا نشانی را بدون نقشه بنویسید.',
              'Some tiles did not load. Retry or enter the address without a map.',
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              if (!latest.current.disabled) {
                resetAvailability();
                setRetry((value) => value + 1);
              }
            }}
          >
            {text('تلاش دوباره', 'Retry map')}
          </Button>
        </div>
      )}
      <div className="address-map-footer">
        <p role="status">
          {moving
            ? text(
                'نقشه را رها کنید تا نقطه آمادهٔ تأیید شود.',
                'Release the map to confirm the point.',
              )
            : view.zoom < 14
              ? text(
                  'برای انتخاب دقیق، نمای محله را باز کنید یا بیشتر بزرگ کنید.',
                  'Open neighborhood view or zoom in to select precisely.',
                )
              : !ready
                ? text('منتظر دریافت نقشهٔ زیر نشانگر باشید.', 'Waiting for the map under the pin.')
                : selected
                  ? text('نشانگر روی نقطهٔ انتخاب‌شده است.', 'The pin is on the selected point.')
                  : text(
                      'محل درست است؟ نقطه را تأیید کنید؛ ثبت نشانی در فرم انجام می‌شود.',
                      'Is this the right place? Confirm the point, then save the address in the form.',
                    )}
        </p>
        <div className="address-map-actions">
          {expanded && onManual && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                if (latest.current.disabled) return;
                cancelLarge();
                closeAction.current = 'manual';
              }}
            >
              {text('ثبت دستی نشانی', 'Enter address manually')}
            </Button>
          )}
          {expanded && !onManual && (
            <Button type="button" variant="outline" onClick={cancelLarge}>
              {text('انصراف', 'Cancel')}
            </Button>
          )}
          <Button type="button" disabled={!canConfirm} onClick={confirm}>
            <Check size={18} />
            {text('تأیید این نقطه', 'Confirm this point')}
          </Button>
        </div>
      </div>
      <small className="address-map-credit">
        <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">
          GeoNames (CC BY 4.0)
        </a>{' '}
        ·{' '}
        <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">
          {text('گزارش اشکال نقشه', 'Report map issue')}
        </a>
      </small>
    </div>
  );
  return (
    <div className={`address-map-shell${presentation === 'compact' ? ' address-map-compact' : ''}`}>
      {presentation === 'compact' ? (
        <div className="address-map-preview-card">
          {!expanded && point && (
            <div className="address-map-preview">
              <div
                ref={connectHost}
                className="address-map-surface"
                dir="ltr"
                role="region"
                aria-label={text('پیش‌نمایش نقطهٔ انتخاب‌شده', 'Selected location preview')}
                aria-busy={!initialized && !failed}
              />
              {failed && (
                <p className="address-map-preview-error" role="status">
                  {text(
                    'پیش‌نمایش دریافت نشد؛ موقعیت انتخاب‌شده محفوظ است.',
                    'Preview unavailable; your selected point is retained.',
                  )}
                </p>
              )}
            </div>
          )}
          <button
            ref={expandButton}
            type="button"
            className="button button-outline address-map-edit"
            disabled={disabled}
            onClick={openLarge}
          >
            {point ? <Pencil size={17} /> : <MapPin size={18} />}
            {point
              ? text('ویرایش موقعیت', 'Edit location')
              : text('انتخاب موقعیت روی نقشه', 'Choose a map location')}
          </button>
          {point && (
            <p className="address-map-summary">
              <Check size={17} />
              <span>{summary || text('نقطهٔ تحویل انتخاب شد', 'Delivery point selected')}</span>
            </p>
          )}
        </div>
      ) : (
        <div className="address-map-intro">
          <p>{guide}</p>
          <button
            ref={expandButton}
            className="button button-outline address-map-expand"
            type="button"
            disabled={disabled}
            onClick={openLarge}
          >
            <Maximize2 size={18} />
            {text('نقشهٔ بزرگ‌تر', 'Larger map')}
          </button>
        </div>
      )}
      {!expanded && presentation === 'inline' && picker}
      <Modal
        open={expanded}
        onOpenChange={(open) => {
          if (!open) cancelLarge();
        }}
        title={text('انتخاب موقعیت تحویل', 'Choose delivery location')}
        description={text(
          'نقشه را جابه‌جا کنید تا محل تحویل زیر نشانگر قرار بگیرد.',
          'Move the map to put the delivery location under the pin.',
        )}
        className="address-map-dialog"
        restoreFocusRef={expandButton}
        onCloseFocus={() => {
          const action = closeAction.current;
          closeAction.current = null;
          if (action === 'manual' && onManual) onManual();
          else if (action === 'continue' && onContinue) onContinue();
          else expandButton.current?.focus({ preventScroll: true });
        }}
      >
        {expanded && picker}
      </Modal>
    </div>
  );
}
