import test from 'node:test';
import assert from 'node:assert/strict';
import {
  digitalUiHarness,
  uiElements,
  uiText,
  type TestElement,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import { cities, deliveryPoint, findCity } from '../lib/address/address-geography.ts';
import {
  searchAddressLocations,
  type AddressLocationSearchResult,
} from '../lib/address/address-location-search.ts';

type Point = [number, number];
type Coordinates = { z: number; x: number; y: number };
type EventValue = {
  latlng?: { lat: number; lng: number };
  originalEvent?: { detail: number };
  coords?: Coordinates;
  tile?: { isConnected: boolean };
};
type Events = Map<string, ((event: EventValue) => void)[]>;
type Interaction = { enabled: boolean; enable(): void; disable(): void };
type Host = { isConnected: boolean };
type Frame = {
  host: Host;
  options: Record<string, unknown>;
  center: Point;
  zoom: number;
  removed: number;
  invalidated: number;
  pans: Point[];
  events: Events;
  dragging: Interaction;
  touchZoom: Interaction;
  doubleClickZoom: Interaction;
  keyboard: Interaction;
  boxZoom: Interaction;
  scrollWheelZoom: Interaction;
  on(names: string, callback: (event: EventValue) => void): Frame;
  fire(name: string, value?: EventValue): void;
  setView(center: Point, zoom: number): Frame;
  panTo(center: { lat: number; lng: number } | Point): Frame;
  getCenter(): { lat: number; lng: number };
  getZoom(): number;
  project(center: { lat: number; lng: number }, zoom: number): { x: number; y: number };
  zoomIn(amount: number): Frame;
  zoomOut(amount: number): Frame;
  invalidateSize(): Frame;
  remove(): void;
};
type Layer = {
  url: string;
  options: Record<string, unknown>;
  frame: Frame | null;
  events: Events;
  on(names: string, callback: (event: EventValue) => void): Layer;
  fire(name: string, value?: EventValue): void;
  addTo(frame: Frame): Layer;
};

function interaction(): Interaction {
  return {
    enabled: false,
    enable() {
      this.enabled = true;
    },
    disable() {
      this.enabled = false;
    },
  };
}
function subscribe(events: Events, names: string, callback: (event: EventValue) => void) {
  for (const name of names.split(/\s+/)) events.set(name, [...(events.get(name) ?? []), callback]);
}
function emit(events: Events, name: string, value: EventValue = {}) {
  for (const callback of events.get(name) ?? []) callback(value);
}
function coordinates(
  frame: Frame,
  point: Point = frame.center,
  zoom = Math.round(frame.zoom),
): Coordinates {
  const projected = frame.project({ lat: point[0], lng: point[1] }, zoom);
  return { z: zoom, x: Math.floor(projected.x / 256), y: Math.floor(projected.y / 256) };
}
function tile(
  frame: Frame,
  options: { point?: Point; zoom?: number; connected?: boolean; offsetX?: number } = {},
): EventValue {
  const coords = coordinates(frame, options.point, options.zoom);
  coords.x += options.offsetX ?? 0;
  return { coords, tile: { isConnected: options.connected !== false } };
}

function mapHarness(
  options: {
    locale?: 'fa' | 'en';
    point?: Point | null;
    center?: Point | null;
    attach?: boolean;
    failMapAttempts?: number;
    presentation?: 'inline' | 'compact';
    manual?: boolean;
    continue?: boolean;
    summary?: string;
  } = {},
) {
  const maps: Frame[] = [],
    layers: Layer[] = [],
    selected: Point[] = [];
  const selectedAreas: (AddressLocationSearchResult | undefined)[] = [];
  const manual = { calls: 0 };
  const continued = { calls: 0 };
  const markers: { point: Point; removed: number; frame: Frame | null }[] = [];
  const observers: { disconnected: number; callback: () => void; observed: Host | null }[] = [];
  let failures = options.failMapAttempts ?? 0;
  const createMap = (host: Host, mapOptions: Record<string, unknown>) => {
    if (failures-- > 0) throw Error('Synthetic map initialization failure');
    const frame: Frame = {
      host,
      options: mapOptions,
      center: [32.43, 53.68],
      zoom: 5,
      removed: 0,
      invalidated: 0,
      pans: [],
      events: new Map(),
      dragging: interaction(),
      touchZoom: interaction(),
      doubleClickZoom: interaction(),
      keyboard: interaction(),
      boxZoom: interaction(),
      scrollWheelZoom: interaction(),
      on(names, callback) {
        subscribe(frame.events, names, callback);
        return frame;
      },
      fire(name, value) {
        emit(frame.events, name, value);
      },
      setView(center, zoom) {
        frame.fire('movestart');
        const zoomChanged = frame.zoom !== zoom;
        if (zoomChanged) frame.fire('zoomstart');
        frame.center = [...center];
        frame.zoom = zoom;
        if (zoomChanged) frame.fire('zoomend');
        frame.fire('moveend');
        return frame;
      },
      panTo(center) {
        const next: Point = Array.isArray(center) ? [...center] : [center.lat, center.lng];
        frame.pans.push(next);
        return frame.setView(next, frame.zoom);
      },
      getCenter: () => ({ lat: frame.center[0], lng: frame.center[1] }),
      getZoom: () => frame.zoom,
      project(center, zoom) {
        // Public EPSG:3857 project contract, without DOM or network tile requests.
        const scale = 256 * 2 ** zoom,
          sin = Math.sin((center.lat * Math.PI) / 180);
        return {
          x: ((center.lng + 180) / 360) * scale,
          y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
        };
      },
      zoomIn: (amount) => frame.setView(frame.center, Math.min(19, frame.zoom + amount)),
      zoomOut: (amount) => frame.setView(frame.center, Math.max(5, frame.zoom - amount)),
      invalidateSize() {
        frame.invalidated++;
        return frame;
      },
      remove() {
        frame.removed++;
      },
    };
    maps.push(frame);
    return frame;
  };
  const h = digitalUiHarness(
    'apps/storefront/components/address/address-map.tsx',
    {
      '../shared/ui': { Button: 'button', Modal: 'Modal' },
      '@/lib/address/address-geography': { cities, deliveryPoint, findCity },
      '@/lib/address/address-location-search': { searchAddressLocations },
      'leaflet/dist/leaflet.css': {},
      './address-map.css': {},
      leaflet: {
        map: createMap,
        tileLayer(url: string, layerOptions: Record<string, unknown>) {
          const layer: Layer = {
            url,
            options: layerOptions,
            frame: null,
            events: new Map(),
            on(names, callback) {
              subscribe(layer.events, names, callback);
              return layer;
            },
            fire(name, value) {
              emit(layer.events, name, value);
            },
            addTo(frame) {
              layer.frame = frame;
              return layer;
            },
          };
          layers.push(layer);
          return layer;
        },
        control: { scale: () => ({ addTo() {} }) },
        divIcon: () => ({}),
        marker(point: Point) {
          const entry = { point: [...point] as Point, removed: 0, frame: null as Frame | null };
          markers.push(entry);
          const marker = {
            addTo(frame: Frame) {
              entry.frame = frame;
              return marker;
            },
            setLatLng(point: Point) {
              entry.point = [...point];
              return marker;
            },
            remove() {
              entry.removed++;
            },
          };
          return marker;
        },
      },
    },
    {
      matchMedia: () => ({ matches: false }),
      ResizeObserver: class {
        private readonly entry: (typeof observers)[number];
        constructor(callback: () => void) {
          this.entry = { disconnected: 0, callback, observed: null };
          observers.push(this.entry);
        }
        observe(node: Host) {
          this.entry.observed = node;
        }
        disconnect() {
          this.entry.disconnected++;
        }
      },
    },
  );
  let props = {
    locale: options.locale ?? 'en',
    center: options.center === null ? undefined : ((options.center ?? [35.6892, 51.389]) as Point),
    point: options.point ?? null,
    disabled: false,
    presentation: options.presentation ?? 'inline',
    summary: options.summary,
    onManual: options.manual ? () => manual.calls++ : undefined,
    onContinue: options.continue ? () => continued.calls++ : undefined,
    onChange: (point: Point, area?: AddressLocationSearchResult) => {
      selected.push([...point]);
      selectedAreas.push(area);
    },
  };
  let host: Host | null = null;
  let hostRef: ((node: Host | null) => void) | null = null;
  const trigger = {
    isConnected: true,
    focusCalls: 0,
    focus() {
      trigger.focusCalls++;
    },
  };
  h.mount('default', props);
  function element(predicate: (node: TestElement) => boolean) {
    const node = uiElements(h.tree()).find(predicate);
    assert.ok(node, 'Expected map UI element');
    return node;
  }
  const surface = () => element((node) => node.props.className === 'address-map-surface');
  const button = (name: RegExp) =>
    element((node) => node.type === 'button' && name.test(uiText(node)));
  const modal = () => element((node) => node.type === 'Modal');
  const confirm = () => button(/Confirm this point|تأیید این نقطه/);
  const expand = () =>
    button(
      /Larger map|نقشهٔ بزرگ‌تر|Edit location|ویرایش موقعیت|Choose a map location|انتخاب موقعیت روی نقشه/,
    );
  const search = () => element((node) => node.type === 'input' && node.props.type === 'search');
  (expand().props.ref as { current: unknown }).current = trigger;
  function attach() {
    host = { isConnected: true };
    hostRef = surface().props.ref as (node: Host | null) => void;
    hostRef(host);
  }
  if (options.attach !== false) attach();
  return {
    h,
    maps,
    layers,
    markers,
    observers,
    selected,
    selectedAreas,
    manual,
    continued,
    trigger,
    element,
    button,
    modal,
    closedFocus() {
      (modal().props.onCloseFocus as () => void)();
    },
    confirm,
    expand,
    search,
    async query(value: string) {
      (search().props.onChange as (event: unknown) => void)({ target: { value } });
      await h.settle();
    },
    attach,
    current: () => {
      assert.ok(maps.length, 'Expected initialized map');
      return maps.at(-1)!;
    },
    layer: () => {
      assert.ok(layers.length, 'Expected initialized tile layer');
      return layers.at(-1)!;
    },
    async update(next: Partial<typeof props>) {
      props = { ...props, ...next };
      h.rerender(props);
      await h.settle();
    },
    async transferHost(next: Partial<typeof props> = {}) {
      // Simulate React removing the old inline/Portal node before mounting the
      // new one. The harness does not implement DOM refs or Radix portals.
      if (host) host.isConnected = false;
      hostRef?.(null);
      props = { ...props, ...next };
      h.rerender(props);
      await h.settle();
      attach();
      await h.settle();
      assert.equal(maps.filter((frame) => frame.removed === 0).length, 1);
    },
    loadCenter() {
      const layer = layers.at(-1)!;
      assert.ok(layer.frame);
      layer.fire('tileload', tile(layer.frame));
    },
    click(point: Point, detail = 1) {
      const frame = maps.at(-1)!;
      frame.fire('click', { latlng: { lat: point[0], lng: point[1] }, originalEvent: { detail } });
    },
  };
}

test('county map starts at zoom14 with natural drag/pinch and only explicit confirmation chooses a point', async () => {
  const m = mapHarness({ locale: 'fa' });
  await m.h.settle();
  const frame = m.current();
  assert.equal(frame.zoom, 14);
  assert.deepEqual(frame.center, [35.6892, 51.389]);
  assert.equal(frame.options.dragging, true);
  assert.equal(frame.options.zoomControl, false);
  for (const handler of [
    frame.dragging,
    frame.touchZoom,
    frame.doubleClickZoom,
    frame.keyboard,
    frame.boxZoom,
  ])
    assert.equal(handler.enabled, true);
  assert.equal(frame.scrollWheelZoom.enabled, false);
  assert.equal(m.confirm().props.disabled, true);
  assert.deepEqual(m.selected, []);
  assert.equal(
    uiElements(m.h.tree()).filter((node) => node.props.className === 'address-map-surface').length,
    1,
  );
  assert.ok(
    uiElements(m.h.tree()).some(
      (node) =>
        node.props.className === 'address-map-target' && node.props['aria-hidden'] === 'true',
    ),
  );
  m.click([35.70123456, 51.40123456]);
  await m.h.settle();
  assert.deepEqual(m.selected, []);
  assert.deepEqual(frame.center, [35.70123456, 51.40123456]);
  m.loadCenter();
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, false);
  (m.confirm().props.onClick as () => void)();
  assert.deepEqual(m.selected, [[35.701235, 51.401235]]);
  m.h.unmount();
  assert.equal(frame.removed, 1);
});

test('only a connected center tile enables confirmation; unload, error and unrelated tiles have distinct effects', async () => {
  const m = mapHarness();
  await m.h.settle();
  const frame = m.current(),
    layer = m.layer();
  layer.fire('tileload', tile(frame, { offsetX: 1 }));
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, true);
  layer.fire('tileload', tile(frame, { zoom: 15 }));
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, true, 'Another zoom level cannot prove the center tile');
  layer.fire('tileload', tile(frame, { connected: false }));
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, true);
  m.loadCenter();
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, false);
  layer.fire('tileerror', tile(frame, { offsetX: 1 }));
  await m.h.settle();
  assert.equal(
    m.confirm().props.disabled,
    false,
    'A visible center survives an adjacent tile error',
  );
  assert.match(uiText(m.h.tree()), /Some tiles did not load/);
  layer.fire('tileunload', tile(frame, { connected: false }));
  await m.h.settle();
  assert.equal(
    m.confirm().props.disabled,
    true,
    'Leaflet unload runs after removing the image from DOM',
  );
  m.loadCenter();
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, false);
  layer.fire('loading');
  await m.h.settle();
  assert.equal(
    m.confirm().props.disabled,
    false,
    'Loading must not forget already visible center tiles',
  );
  layer.fire('tileerror', tile(frame));
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, true);
  layer.fire('load');
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, true, 'All failed tiles still emit load');
  assert.deepEqual(m.selected, []);
  m.h.unmount();
});

test('stale confirm handlers recheck movement, zoom, center tiles, bounds and current disabled state', async () => {
  const m = mapHarness();
  await m.h.settle();
  m.loadCenter();
  await m.h.settle();
  const frame = m.current(),
    confirm = m.confirm().props.onClick as () => void;
  frame.fire('movestart');
  confirm();
  assert.deepEqual(m.selected, [], 'Guard movement before React repaints');
  frame.fire('moveend');
  frame.zoom = 13;
  m.layer().fire('tileload', tile(frame));
  confirm();
  assert.deepEqual(m.selected, []);
  frame.zoom = 14;
  frame.center = [36.5, 52.5];
  confirm();
  assert.deepEqual(m.selected, [], 'New center has no loaded tile');
  frame.center = [0, 0];
  m.layer().fire('tileload', tile(frame));
  confirm();
  assert.deepEqual(m.selected, []);
  frame.center = [35.7, 51.4];
  frame.fire('moveend');
  m.loadCenter();
  await m.h.settle();
  const oldClick = m.button(/County center|مرکز شهرستان/).props.onClick as () => void;
  const oldExpand = m.expand().props.onClick as () => void;
  const oldZoom = m.element((node) => node.props['aria-label'] === 'Zoom in').props
    .onClick as () => void;
  await m.update({ disabled: true });
  confirm();
  oldClick();
  oldExpand();
  oldZoom();
  m.click([35.8, 51.6]);
  assert.deepEqual(m.selected, []);
  assert.deepEqual(frame.center, [35.7, 51.4]);
  assert.equal(frame.zoom, 14);
  assert.equal(m.modal().props.open, false);
  for (const handler of [
    frame.dragging,
    frame.touchZoom,
    frame.doubleClickZoom,
    frame.keyboard,
    frame.boxZoom,
    frame.scrollWheelZoom,
  ])
    assert.equal(handler.enabled, false);
  await m.update({ disabled: false });
  m.loadCenter();
  await m.h.settle();
  confirm();
  assert.equal(m.selected.length, 1);
  m.h.unmount();
});

test('double clicks and invalid clicks do not change the candidate, while controls only move the viewport', async () => {
  const m = mapHarness({ point: [35.71, 51.41] });
  await m.h.settle();
  const frame = m.current();
  assert.equal(frame.zoom, 16);
  m.click([0, 0]);
  m.click([35.8, 51.5], 2);
  assert.deepEqual(frame.center, [35.71, 51.41]);
  assert.equal(frame.pans.length, 0);
  (m.button(/County center|مرکز شهرستان/).props.onClick as () => void)();
  await m.h.settle();
  assert.deepEqual(frame.center, [35.6892, 51.389]);
  assert.equal(frame.zoom, 14);
  (m.button(/Selected point/).props.onClick as () => void)();
  await m.h.settle();
  assert.deepEqual(frame.center, [35.71, 51.41]);
  assert.equal(frame.zoom, 16);
  const zoomIn = m.element((node) => node.props['aria-label'] === 'Zoom in');
  (zoomIn.props.onClick as () => void)();
  await m.h.settle();
  assert.equal(frame.zoom, 17);
  assert.deepEqual(m.selected, []);
  m.h.unmount();
});

test('external point replacement and clear reset the draft without choosing anything, while identical coordinates preserve a panned draft', async () => {
  const saved: Point = [35.71, 51.41],
    next: Point = [36.21, 52.31];
  const m = mapHarness({ point: saved });
  await m.h.settle();
  assert.equal(m.markers.length, 1);
  assert.deepEqual(m.markers[0].point, saved);
  m.click([35.8, 51.5]);
  await m.h.settle();
  await m.update({ point: [...saved] });
  assert.deepEqual(
    m.current().center,
    [35.8, 51.5],
    'A fresh props tuple with equal values must not recenter',
  );
  await m.update({ point: next });
  assert.deepEqual(m.current().center, next);
  assert.equal(m.current().zoom, 16);
  assert.deepEqual(m.markers[0].point, next);
  await m.update({ point: null });
  assert.deepEqual(m.current().center, [35.6892, 51.389]);
  assert.equal(m.current().zoom, 14);
  assert.equal(m.markers[0].removed, 1);
  assert.deepEqual(m.selected, []);
  m.h.unmount();
});

test('expanded map cancellation restores the pre-expand draft and never changes the parent point', async () => {
  const m = mapHarness({ point: [35.71, 51.41] });
  await m.h.settle();
  m.click([35.8, 51.5]);
  await m.h.settle();
  const before = m.current();
  (m.expand().props.onClick as () => void)();
  await m.transferHost();
  assert.equal(m.modal().props.open, true);
  assert.equal(before.removed, 1);
  assert.deepEqual(m.current().center, [35.8, 51.5]);
  assert.equal(m.current().scrollWheelZoom.enabled, true);
  assert.equal((m.modal().props.restoreFocusRef as { current: unknown }).current, m.trigger);
  m.click([36.2, 52.3]);
  await m.h.settle();
  (m.modal().props.onOpenChange as (open: boolean) => void)(false);
  await m.transferHost();
  assert.equal(m.modal().props.open, false);
  assert.deepEqual(m.current().center, [35.8, 51.5]);
  assert.deepEqual(m.selected, []);
  assert.equal(m.current().scrollWheelZoom.enabled, false);
  (m.expand().props.onClick as () => void)();
  await m.transferHost();
  m.click([36.4, 52.7]);
  await m.h.settle();
  (m.button(/^Cancel$/).props.onClick as () => void)();
  await m.transferHost();
  assert.deepEqual(m.current().center, [35.8, 51.5]);
  assert.deepEqual(m.selected, []);
  m.h.unmount();
  assert.ok(m.maps.every((frame) => frame.removed === 1));
});

test('expanded confirmation keeps the new point through the parent echo and returns to one inline map', async () => {
  const m = mapHarness({ point: [35.71, 51.41] });
  await m.h.settle();
  (m.expand().props.onClick as () => void)();
  await m.transferHost();
  m.click([36.21234567, 52.31234567]);
  await m.h.settle();
  m.loadCenter();
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, false);
  (m.confirm().props.onClick as () => void)();
  assert.deepEqual(m.selected, [[36.212346, 52.312346]]);
  await m.transferHost({ point: m.selected[0] });
  assert.equal(m.modal().props.open, false);
  assert.deepEqual(m.current().center, m.selected[0]);
  assert.equal(m.current().zoom, 16);
  assert.equal(m.maps.filter((frame) => frame.removed === 0).length, 1);
  m.h.unmount();
});

test('clearing the parent point while expanded invalidates the old cancel snapshot', async () => {
  const m = mapHarness({ point: [35.71, 51.41] });
  await m.h.settle();
  m.click([35.8, 51.5]);
  await m.h.settle();
  (m.expand().props.onClick as () => void)();
  await m.transferHost();
  m.click([36.2, 52.3]);
  await m.h.settle();
  await m.update({ point: null });
  (m.modal().props.onOpenChange as (open: boolean) => void)(false);
  await m.transferHost();
  assert.deepEqual(m.current().center, [35.6892, 51.389]);
  assert.equal(m.current().zoom, 14);
  assert.deepEqual(m.selected, []);
  m.h.unmount();
});

test('retry preserves the draft and provider options, removes the old map and rejects its late callbacks', async () => {
  const m = mapHarness();
  await m.h.settle();
  m.click([35.8, 51.5]);
  await m.h.settle();
  m.loadCenter();
  await m.h.settle();
  const old = m.current(),
    oldLayer = m.layer(),
    oldObserver = m.observers[0];
  oldLayer.fire('tileerror', tile(old, { offsetX: 1 }));
  await m.h.settle();
  assert.match(uiText(m.h.tree()), /enter the address without a map/);
  (m.button(/^Retry map$/).props.onClick as () => void)();
  await m.h.settle();
  assert.equal(old.removed, 1);
  assert.equal(oldObserver.disconnected, 1);
  assert.deepEqual(m.current().center, [35.8, 51.5]);
  assert.equal(m.confirm().props.disabled, true);
  assert.equal(m.layer().url, oldLayer.url);
  assert.deepEqual(m.layer().options, oldLayer.options);
  assert.equal(m.layer().options.referrerPolicy, 'strict-origin-when-cross-origin');
  oldLayer.fire('tileload', tile(old));
  oldLayer.fire('tileerror', tile(old));
  old.fire('movestart');
  old.fire('moveend');
  const invalidated = old.invalidated;
  oldObserver.callback();
  await m.h.settle();
  assert.equal(old.invalidated, invalidated);
  assert.equal(m.confirm().props.disabled, true);
  assert.ok(!uiText(m.h.tree()).includes('Some tiles did not load'));
  const oldPans = old.pans.length;
  old.fire('click', { latlng: { lat: 36.5, lng: 52.5 }, originalEvent: { detail: 1 } });
  assert.equal(old.pans.length, oldPans, 'A callback retained from a removed map must be inert');
  m.loadCenter();
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, false);
  m.h.unmount();
  assert.ok(m.maps.every((frame) => frame.removed === 1));
});

test('late Portal host mounting initializes once and an import resolving after unmount never creates a map', async () => {
  const late = mapHarness({ attach: false });
  await late.h.settle();
  assert.equal(late.maps.length, 0);
  late.attach();
  await late.h.settle();
  assert.equal(late.maps.length, 1);
  late.h.unmount();
  assert.equal(late.maps[0].removed, 1);
  const pending = mapHarness();
  const settling = pending.h.settle();
  pending.h.unmount();
  await settling;
  assert.equal(pending.maps.length, 0, 'Disposed import completion must not construct Leaflet');
});

test('initialization failure offers manual fallback and retry without ever selecting a destination', async () => {
  const m = mapHarness({ center: null, failMapAttempts: 1 });
  await m.h.settle();
  assert.equal(m.maps.length, 0);
  assert.equal(m.confirm().props.disabled, true);
  assert.match(uiText(m.h.tree()), /enter the address without a map/);
  (m.button(/^Retry map$/).props.onClick as () => void)();
  await m.h.settle();
  assert.equal(m.maps.length, 1);
  assert.equal(m.current().zoom, 5);
  assert.deepEqual(m.current().center, [32.43, 53.68]);
  assert.deepEqual(m.selected, []);
  assert.equal(m.confirm().props.disabled, true);
  (m.button(/Neighborhood view/).props.onClick as () => void)();
  await m.h.settle();
  assert.equal(m.current().zoom, 16);
  m.loadCenter();
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, false);
  assert.deepEqual(m.selected, []);
  m.h.unmount();
});

test('area search navigates to the real county overview without committing either location or geography', async () => {
  const m = mapHarness();
  await m.h.settle();
  (m.expand().props.onClick as () => void)();
  await m.transferHost();
  await m.query('تجریش');
  assert.match(uiText(m.h.tree()), /Choose the area you want to view/);
  assert.match(uiText(m.h.tree()), /تهران · شمیرانات · تجریش/);
  const area = searchAddressLocations('تجریش')[0];
  assert.equal(area.kind, 'city');
  assert.equal(area.centerSource, 'county');
  (m.button(/تجریش/).props.onClick as () => void)();
  await m.h.settle();
  assert.deepEqual(m.current().center, area.center);
  assert.equal(m.current().zoom, 14);
  assert.equal(m.search().props.value, '');
  assert.match(uiText(m.h.tree()), /Approximate county center; place the exact delivery point/);
  assert.equal(m.confirm().props.disabled, true, 'Navigating still requires a loaded center tile');
  assert.deepEqual(m.selected, []);
  assert.deepEqual(m.selectedAreas, []);
  m.click([35.81234567, 51.51234567]);
  await m.h.settle();
  assert.deepEqual(
    m.selected,
    [],
    'Adjusting the pin must not implicitly commit the search result',
  );
  m.h.unmount();
});

test('cancelling a searched area clears its candidate and restores the previous map before later confirmation', async () => {
  const saved: Point = [35.71, 51.41];
  const m = mapHarness({ point: saved });
  await m.h.settle();
  m.click([35.8, 51.5]);
  await m.h.settle();
  (m.expand().props.onClick as () => void)();
  await m.transferHost();
  await m.query('کاشان');
  (m.button(/کاشان/).props.onClick as () => void)();
  await m.h.settle();
  assert.notDeepEqual(m.current().center, [35.8, 51.5]);
  (m.modal().props.onOpenChange as (open: boolean) => void)(false);
  await m.transferHost();
  assert.deepEqual(m.current().center, [35.8, 51.5]);
  assert.deepEqual(m.selected, []);
  (m.expand().props.onClick as () => void)();
  await m.transferHost();
  assert.equal(m.search().props.value, '');
  assert.doesNotMatch(uiText(m.h.tree()), /Approximate county center/);
  m.loadCenter();
  await m.h.settle();
  (m.confirm().props.onClick as () => void)();
  assert.deepEqual(m.selected, [[35.8, 51.5]]);
  assert.deepEqual(
    m.selectedAreas,
    [undefined],
    'A cancelled area cannot leak into the next choice',
  );
  m.h.unmount();
});

test('confirmation transfers the exact pin and searched parent chain together without using the county center as delivery point', async () => {
  const m = mapHarness({ presentation: 'compact' });
  await m.h.settle();
  assert.equal(m.modal().props.open, true);
  await m.query('تجریش');
  const area = searchAddressLocations('تجریش')[0];
  (m.button(/تجریش/).props.onClick as () => void)();
  await m.h.settle();
  const precise: Point = [35.81234567, 51.51234567];
  assert.notDeepEqual(precise, area.center);
  m.click(precise);
  await m.h.settle();
  m.loadCenter();
  await m.h.settle();
  (m.confirm().props.onClick as () => void)();
  assert.deepEqual(m.selected, [[35.812346, 51.512346]]);
  assert.deepEqual(m.selectedAreas, [area]);
  await m.transferHost({ point: m.selected[0] });
  assert.equal(m.modal().props.open, false);
  assert.deepEqual(m.current().center, m.selected[0]);
  m.h.unmount();
});

test('compact picker becomes a read-only preview after confirmation and editing reopens an interactive dialog', async () => {
  const m = mapHarness({ presentation: 'compact', summary: 'تهران، شمیرانات، تجریش' });
  await m.h.settle();
  assert.equal(m.modal().props.open, true);
  assert.equal(m.current().dragging.enabled, true);
  assert.equal(m.current().scrollWheelZoom.enabled, true);
  m.click([35.81, 51.51]);
  await m.h.settle();
  m.loadCenter();
  await m.h.settle();
  (m.confirm().props.onClick as () => void)();
  await m.transferHost({ point: m.selected[0] });
  assert.equal(m.modal().props.open, false);
  assert.match(uiText(m.h.tree()), /تهران، شمیرانات، تجریش/);
  assert.doesNotMatch(uiText(m.h.tree()), /Complete the street, plaque and postal code below/);
  assert.equal(
    m.element((node) => node.props['aria-label'] === 'Selected location preview').props.tabIndex,
    undefined,
  );
  const preview = m.current();
  for (const handler of [
    preview.dragging,
    preview.touchZoom,
    preview.doubleClickZoom,
    preview.keyboard,
    preview.boxZoom,
    preview.scrollWheelZoom,
  ])
    assert.equal(handler.enabled, false);
  assert.ok(!uiElements(m.h.tree()).some((node) => node.props['aria-label'] === 'Zoom in'));
  assert.ok(!uiElements(m.h.tree()).some((node) => node.type === 'input'));
  assert.ok(!uiText(m.h.tree()).includes('Confirm this point'));
  m.click([36.2, 52.3]);
  assert.deepEqual(preview.center, [35.81, 51.51], 'A read-only preview ignores map clicks');
  (m.expand().props.onClick as () => void)();
  await m.transferHost();
  assert.equal(m.modal().props.open, true);
  assert.equal(preview.removed, 1);
  assert.equal(m.current().dragging.enabled, true);
  assert.equal(m.current().scrollWheelZoom.enabled, true);
  assert.equal(m.search().props.value, '');
  m.h.unmount();
});

test('manual entry cancels the draft and searched area, preserving the saved point and invoking only the manual callback', async () => {
  const saved: Point = [35.71, 51.41];
  const m = mapHarness({ point: saved, presentation: 'compact', manual: true });
  await m.h.settle();
  await m.query('کاشان');
  (m.button(/کاشان/).props.onClick as () => void)();
  await m.h.settle();
  m.click([34.1, 51.4]);
  await m.h.settle();
  (m.button(/^Enter address manually$/).props.onClick as () => void)();
  await m.transferHost();
  assert.equal(m.manual.calls, 0, 'Focus must wait until the dialog has finished closing');
  m.closedFocus();
  assert.equal(m.manual.calls, 1);
  assert.equal(m.modal().props.open, false);
  assert.deepEqual(m.current().center, saved);
  assert.deepEqual(m.selected, []);
  assert.deepEqual(m.selectedAreas, []);
  m.closedFocus();
  assert.equal(m.manual.calls, 1, 'The manual close action is consumed exactly once');
  (m.expand().props.onClick as () => void)();
  await m.transferHost();
  assert.equal(m.search().props.value, '');
  assert.doesNotMatch(uiText(m.h.tree()), /Approximate county center/);
  m.loadCenter();
  await m.h.settle();
  (m.confirm().props.onClick as () => void)();
  assert.deepEqual(m.selected, [saved]);
  assert.deepEqual(m.selectedAreas, [undefined]);
  m.h.unmount();
});

test('an area selected before Leaflet initializes survives delayed host mounting without any implicit commit', async () => {
  const m = mapHarness({ presentation: 'compact', attach: false });
  await m.h.settle();
  assert.equal(m.maps.length, 0);
  await m.query('کاشان');
  const area = searchAddressLocations('کاشان')[0];
  (m.button(/کاشان/).props.onClick as () => void)();
  await m.h.settle();
  assert.equal(m.maps.length, 0);
  assert.equal(m.confirm().props.disabled, true);
  assert.match(uiText(m.h.tree()), /Approximate county center/);
  m.attach();
  await m.h.settle();
  assert.deepEqual(m.current().center, area.center);
  assert.equal(m.current().zoom, 14);
  assert.deepEqual(m.selected, []);
  assert.deepEqual(m.selectedAreas, []);
  m.h.unmount();
});

test('county search requires an actual child city and rejects forged, unrelated or disabled selections before confirming', async () => {
  const m = mapHarness({ presentation: 'compact', manual: true });
  await m.h.settle();
  await m.query('شمیرانات');
  const county = searchAddressLocations('شمیرانات').find((area) => area.kind === 'county');
  assert.ok(county);
  (m.button(/^شمیرانات/).props.onClick as () => void)();
  await m.h.settle();
  const citySelect = () => m.element((node) => node.type === 'select');
  const cityOptions = uiElements(citySelect())
    .filter((node) => node.type === 'option' && node.props.value)
    .map((node) => node.props.value);
  assert.deepEqual(
    cityOptions,
    cities.filter((city) => city.countyId === county.countyId).map((city) => city.id),
  );
  const chooseCity = citySelect().props.onChange as (event: unknown) => void;
  m.loadCenter();
  await m.h.settle();
  assert.equal(m.confirm().props.disabled, true);
  (m.confirm().props.onClick as () => void)();
  assert.deepEqual(m.selected, [], 'A county is not a valid delivery-city identity');
  for (const value of ['invalid-id', '1230001001576']) {
    chooseCity({ target: { value } });
    await m.h.settle();
    assert.equal(m.confirm().props.disabled, true);
  }
  const city = cities.find((city) => city.countyId === county.countyId);
  assert.ok(city);
  await m.update({ disabled: true });
  assert.equal(citySelect().props.disabled, true);
  chooseCity({ target: { value: city.id } });
  await m.h.settle();
  assert.ok(uiElements(m.h.tree()).some((node) => node.type === 'select'));
  assert.deepEqual(m.selected, []);
  await m.update({ disabled: false });
  chooseCity({ target: { value: city.id } });
  await m.h.settle();
  assert.ok(!uiElements(m.h.tree()).some((node) => node.type === 'select'));
  assert.equal(m.confirm().props.disabled, false);
  (m.confirm().props.onClick as () => void)();
  assert.equal(m.selectedAreas.length, 1);
  const area = m.selectedAreas[0];
  assert.ok(area);
  assert.equal(area.kind, 'city');
  assert.equal(area.cityId, city.id);
  assert.equal(area.countyId, city.countyId);
  assert.equal(area.provinceId, city.provinceId);
  assert.equal(area.centerSource, 'county');
  assert.deepEqual(area.center, county.center);
  m.h.unmount();
});

test('county-center shortcut follows the searched county while selected-point shortcut clears that area candidate', async () => {
  const saved: Point = [35.71, 51.41];
  const m = mapHarness({ presentation: 'compact', point: saved });
  await m.h.settle();
  await m.query('کاشان');
  const area = searchAddressLocations('کاشان')[0];
  assert.notDeepEqual(area.center, saved);
  (m.button(/کاشان/).props.onClick as () => void)();
  await m.h.settle();
  m.click([34.1, 51.4]);
  await m.h.settle();
  (m.button(/^County center$/).props.onClick as () => void)();
  await m.h.settle();
  assert.deepEqual(m.current().center, area.center);
  assert.match(uiText(m.h.tree()), /Approximate county center/);
  (m.button(/^Selected point$/).props.onClick as () => void)();
  await m.h.settle();
  assert.deepEqual(m.current().center, saved);
  assert.doesNotMatch(uiText(m.h.tree()), /Approximate county center/);
  m.loadCenter();
  await m.h.settle();
  (m.confirm().props.onClick as () => void)();
  assert.deepEqual(m.selected, [saved]);
  assert.deepEqual(m.selectedAreas, [undefined]);
  m.h.unmount();
});

test('external point or county-center replacement invalidates both the area candidate and outstanding search', async () => {
  const updated: Point = [36.21, 52.31];
  for (const field of ['point', 'center'] as const) {
    const m = mapHarness({ presentation: 'compact' });
    await m.h.settle();
    await m.query('کاشان');
    (m.button(/کاشان/).props.onClick as () => void)();
    await m.h.settle();
    assert.match(uiText(m.h.tree()), /Approximate county center/);
    await m.query('تجریش');
    await m.update({ [field]: updated });
    assert.equal(m.search().props.value, '');
    assert.doesNotMatch(uiText(m.h.tree()), /Approximate county center/);
    assert.deepEqual(m.current().center, updated);
    assert.equal(m.current().zoom, field === 'point' ? 16 : 14);
    m.loadCenter();
    await m.h.settle();
    (m.confirm().props.onClick as () => void)();
    assert.deepEqual(m.selected, [updated]);
    assert.deepEqual(m.selectedAreas, [undefined]);
    m.h.unmount();
  }
});

test('confirmed picker continues only after dialog close focus and cancellation never invokes continuation', async () => {
  const m = mapHarness({ presentation: 'compact', continue: true });
  await m.h.settle();
  m.loadCenter();
  await m.h.settle();
  (m.confirm().props.onClick as () => void)();
  assert.equal(m.selected.length, 1);
  assert.equal(m.continued.calls, 0);
  await m.transferHost({ point: m.selected[0] });
  assert.equal(m.continued.calls, 0);
  m.closedFocus();
  assert.equal(m.continued.calls, 1);
  m.closedFocus();
  assert.equal(m.continued.calls, 1, 'The continuation is consumed exactly once');
  assert.equal(m.trigger.focusCalls, 1);
  (m.expand().props.onClick as () => void)();
  await m.transferHost();
  (m.modal().props.onOpenChange as (open: boolean) => void)(false);
  await m.transferHost();
  m.closedFocus();
  assert.equal(m.continued.calls, 1);
  assert.equal(m.trigger.focusCalls, 2, 'Ordinary cancellation restores the edit trigger');
  m.h.unmount();
});

test('search Enter cannot submit the address form and Escape clears search before the dialog receives another Escape', async () => {
  const m = mapHarness({ presentation: 'compact' });
  await m.h.settle();
  await m.query('تجریش');
  const enter = { key: 'Enter', prevented: 0, stopped: 0 };
  const key = (state: typeof enter) => ({
    key: state.key,
    preventDefault() {
      state.prevented++;
    },
    stopPropagation() {
      state.stopped++;
    },
  });
  (m.search().props.onKeyDown as (event: unknown) => void)(key(enter));
  await m.h.settle();
  assert.equal(enter.prevented, 1);
  assert.equal(enter.stopped, 0);
  assert.equal(m.search().props.value, 'تجریش');
  assert.equal(m.modal().props.open, true);
  const escape = { key: 'Escape', prevented: 0, stopped: 0 };
  (m.search().props.onKeyDown as (event: unknown) => void)(key(escape));
  await m.h.settle();
  assert.equal(escape.prevented, 1);
  assert.equal(escape.stopped, 1);
  assert.equal(m.search().props.value, '');
  assert.equal(m.modal().props.open, true);
  const emptyEscape = { key: 'Escape', prevented: 0, stopped: 0 };
  (m.search().props.onKeyDown as (event: unknown) => void)(key(emptyEscape));
  assert.equal(emptyEscape.prevented, 0);
  assert.equal(emptyEscape.stopped, 0, 'An empty search leaves Escape to the accessible dialog');
  assert.deepEqual(m.selected, []);
  m.h.unmount();
});

test('disabled picker disables search and guards retained search, manual and confirmation actions', async () => {
  const m = mapHarness({ presentation: 'compact', manual: true });
  await m.h.settle();
  await m.query('تجریش');
  const oldResult = m.button(/تجریش/).props.onClick as () => void;
  const oldManual = m.button(/^Enter address manually$/).props.onClick as () => void;
  m.loadCenter();
  await m.h.settle();
  const oldConfirm = m.confirm().props.onClick as () => void;
  const before = [...m.current().center];
  await m.update({ disabled: true });
  assert.equal(m.search().props.disabled, true);
  assert.equal(m.confirm().props.disabled, true);
  assert.equal(m.button(/تجریش/).props.disabled, true);
  assert.equal(m.button(/^Enter address manually$/).props.disabled, true);
  oldResult();
  oldManual();
  oldConfirm();
  assert.deepEqual(m.current().center, before);
  assert.equal(m.search().props.value, 'تجریش');
  assert.equal(m.manual.calls, 0);
  assert.deepEqual(m.selected, []);
  assert.deepEqual(m.selectedAreas, []);
  assert.equal(m.modal().props.open, true);
  m.h.unmount();
});
