import {
  paletteRegions,
  sectionColor,
  type PaletteRegion,
  type PaletteTheme as Theme,
  type SitePalette,
} from './site-palette.ts';

type Rgb = [number, number, number];

const themes = {
  light: { fill: '#405833', surface: '#ffffff', contrastSurface: '#dfdfdf' },
  dark: { fill: '#aac282', surface: '#1a1d18', contrastSurface: '#414141' },
} satisfies Record<Theme, { fill: string; surface: string; contrastSurface: string }>;

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const hex = (color: Rgb) => '#' + color.map((c) => c.toString(16).padStart(2, '0')).join('');
const validColor = (value: string | undefined): value is string =>
  value?.length === 7 && /^#[0-9a-f]{6}$/i.test(value);

function luminance(color: Rgb) {
  const [r, g, b] = color.map((byte) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mix(color: Rgb, target: Rgb, fraction: number): Rgb {
  return color.map((channel, index) =>
    Math.round(channel + (target[index] - channel) * fraction),
  ) as Rgb;
}

const black: Rgb = [0, 0, 0];
const white: Rgb = [255, 255, 255];

// Each channel moves monotonically toward black or white, as does luminance.
function fitColor(color: Rgb, target: Rgb, allowed: (light: number) => boolean): string {
  let lower = 0;
  let upper = 256;
  while (lower < upper) {
    const step = (lower + upper) >>> 1;
    if (allowed(luminance(mix(color, target, step / 256)))) upper = step;
    else lower = step + 1;
  }
  return hex(mix(color, target, lower / 256));
}

export function resolveBrandColors(theme: Theme, primary?: string) {
  const { fill: fallback, surface, contrastSurface } = themes[theme];
  const fill = validColor(primary) ? primary : fallback;
  const color = rgb(fill);
  const background = luminance(color);
  const onBlack = contrast(background, 0);
  const onWhite = contrast(background, 1);
  // Their product is 21, so the better of black and white always exceeds 4.5:1.
  const useBlack = onBlack >= onWhite;
  const surfaceLuminance = luminance(rgb(contrastSurface));
  const accent = fitColor(
    color,
    theme === 'light' ? black : white,
    (candidate) =>
      (theme === 'light' ? candidate < surfaceLuminance : candidate > surfaceLuminance) &&
      contrast(candidate, surfaceLuminance) >= 4.5,
  );

  return {
    fill,
    text: useBlack ? '#000000' : '#ffffff',
    ratio: Math.max(onBlack, onWhite),
    // Tint away from the text's luminance so hover never reduces its contrast.
    hover: hex(mix(color, useBlack ? white : black, 0.12)),
    accent,
    surface,
  };
}

const intensity = {
  soft: { tint: 0.035, card: 0.014, surface: 0.065, spotlight: 0.23, variety: 0.32 },
  balanced: { tint: 0.06, card: 0.026, surface: 0.11, spotlight: 0.36, variety: 0.48 },
  strong: { tint: 0.085, card: 0.04, surface: 0.16, spotlight: 0.5, variety: 0.62 },
};

const varietySeeds = {
  light: { navigation: '#799cc4', hero: '#75a88d', cards: '#a085c9', promotions: '#d58958' },
  dark: { navigation: '#4d79a3', hero: '#4b9a76', cards: '#8266b0', promotions: '#b87550' },
} as const;

// The separate tone bands leave space between a page, a card and its media.
// Apply them to explicit overrides too: setting the same color for all areas
// must not erase their visual hierarchy.
const roleTones = {
  light: {
    canvas: ['#eef0eb', '#e7e7e7', '#eeeeee'],
    navigation: ['#fcfdfb', '#eeeeee', '#ffffff'],
    cards: ['#ffffff', '#f9f9f9', '#ffffff'],
    promotions: ['#edf0e7', '#e5e5e5', '#f1f1f1'],
    footer: ['#e6eae0', '#e5e5e5', '#eeeeee'],
    hero: ['#eaf0e3', '#e5e5e5', '#f1f1f1'],
    media: ['#edf0e9', '#e7e7e7', '#f0f0f0'],
  },
  dark: {
    canvas: ['#141814', '#101010', '#191919'],
    navigation: ['#232922', '#222222', '#2e2e2e'],
    cards: ['#292e27', '#292929', '#303030'],
    promotions: ['#2d352b', '#242424', '#373737'],
    footer: ['#222920', '#202020', '#2d2d2d'],
    hero: ['#2b3529', '#282828', '#383838'],
    media: ['#343c32', '#353535', '#3b3b3b'],
  },
} as const;

function fitTone(color: Rgb, low: string, high: string) {
  const min = luminance(rgb(low));
  const max = luminance(rgb(high));
  const light = luminance(color);
  if (light < min) return fitColor(color, white, (candidate) => candidate >= min);
  if (light > max) return fitColor(color, black, (candidate) => candidate <= max);
  return hex(color);
}

function fitSurface(color: Rgb, theme: Theme) {
  // Leave room for a glass header to blend with the content behind it.
  const boundary = luminance(rgb(theme === 'light' ? '#e5e5e5' : '#3a3a3a'));
  return fitColor(color, theme === 'light' ? white : black, (light) =>
    theme === 'light' ? light >= boundary : light <= boundary,
  );
}

export function resolveStorefrontColors(theme: Theme, palette?: SitePalette) {
  const brand = resolveBrandColors(
    theme,
    theme === 'light' ? palette?.primaryLight : palette?.primaryDark,
  );
  const base = rgb(brand.surface);
  const roles = roleTones[theme];
  const brandRgb = rgb(brand.fill);
  const weights = intensity[palette?.intensity ?? 'balanced'];
  const dark = theme === 'dark';
  const variation = (role: keyof (typeof varietySeeds)['light']) => {
    const fallback = rgb(varietySeeds[theme][role]);
    const chosen = sectionColor(palette, role, theme);
    // A little of the role's own hue keeps four identical overrides from
    // collapsing navigation, category cards and campaign art into one tint.
    return validColor(chosen) ? mix(rgb(chosen), fallback, 0.2) : mix(fallback, brandRgb, 0.12);
  };
  const tint = fitSurface(mix(base, brandRgb, weights.tint), theme);
  const strongerTint = fitSurface(mix(base, brandRgb, weights.surface), theme);
  const surface = (region: PaletteRegion) => {
    const override = sectionColor(palette, region, theme);
    const [anchor, low, high] = roles[region];
    const weight =
      region === 'cards' ? weights.card : region === 'canvas' ? weights.tint : weights.surface;
    const color = validColor(override) ? rgb(override) : mix(rgb(anchor), brandRgb, weight);
    return fitTone(color, low, high);
  };
  const regions = Object.fromEntries(
    [...paletteRegions, 'hero' as const].map((region) => [region, surface(region)]),
  ) as Record<PaletteRegion, string>;
  const promo = sectionColor(palette, 'promotions', theme);
  const promoSeed = validColor(promo) ? promo : brand.fill;
  const card = sectionColor(palette, 'cards', theme);
  const media = fitTone(
    mix(rgb(roles.media[0]), validColor(card) ? rgb(card) : brandRgb, weights.surface),
    roles.media[1],
    roles.media[2],
  );
  const boundary = luminance(rgb(theme === 'light' ? '#e5e5e5' : '#414141'));
  const edge = fitColor(
    mix(rgb(theme === 'light' ? '#afb6a9' : '#616d5f'), brandRgb, weights.tint),
    theme === 'light' ? black : white,
    (candidate) =>
      (theme === 'light' ? candidate < boundary : candidate > boundary) &&
      contrast(candidate, boundary) >= 1.65,
  );
  const navTrack = fitTone(
    mix(rgb(regions.navigation), variation('navigation'), weights.variety),
    dark ? '#2c2c2c' : '#e0e0e0',
    dark ? '#393939' : '#efefef',
  );
  const heroArt = fitTone(
    mix(rgb(regions.hero), variation('hero'), weights.variety),
    dark ? '#464646' : '#bcbcbc',
    dark ? '#626262' : '#dbdbdb',
  );
  const heroGlow = fitTone(
    mix(rgb(heroArt), variation('cards'), 0.36),
    dark ? '#484848' : '#c4c4c4',
    dark ? '#656565' : '#e4e4e4',
  );
  const heroInk = resolveBrandColors(theme, heroArt).text;
  const footerSeed = sectionColor(palette, 'footer', theme);
  const footerBand = fitTone(
    mix(rgb('#191e20'), validColor(footerSeed) ? rgb(footerSeed) : brandRgb, 0.34),
    '#202020',
    '#363636',
  );
  const laneSeeds = [
    variation('hero'),
    variation('cards'),
    variation('promotions'),
    variation('navigation'),
    brandRgb,
  ];
  const lanes = laneSeeds.map((seed) => {
    return {
      body: fitTone(
        mix(rgb(regions.cards), seed, weights.variety * (dark ? 0.56 : 0.22)),
        roles.cards[1],
        roles.cards[2],
      ),
      media: fitTone(mix(rgb(media), seed, weights.variety), roles.media[1], roles.media[2]),
      ink: resolveBrandColors(theme, hex(seed)).accent,
    };
  });
  const promoSurface = (role: 'promotions' | 'navigation') =>
    fitTone(
      // Give the cool banner the menu's base as well as its hue. Blending
      // both banners into the warm background can leave them looking alike.
      mix(rgb(regions[role]), variation(role), weights.variety),
      dark ? '#2a2a2a' : '#e3e3e3',
      dark ? '#3b3b3b' : '#ededed',
    );
  return {
    brand,
    tint,
    strongerTint,
    regions,
    media,
    edge,
    lanes,
    navTrack,
    heroArt,
    heroGlow,
    heroInk,
    footerBand,
    promoWarm: promoSurface('promotions'),
    promoCool: promoSurface('navigation'),
    spotlight: fitSurface(mix(rgb('#19221b'), rgb(promoSeed), weights.spotlight), 'dark'),
    spotlightAccent: resolveBrandColors('dark', promoSeed).accent,
  };
}

export function storefrontColorVariables(theme: Theme, palette?: SitePalette) {
  const colors = resolveStorefrontColors(theme, palette);
  return Object.fromEntries(
    [
      ['primary', colors.brand.accent],
      ['primary-fill', colors.brand.fill],
      ['primary-text', colors.brand.text],
      ['primary-hover', colors.brand.hover],
      ['tint', colors.tint],
      ['tint-strong', colors.strongerTint],
      ['hero', colors.regions.hero],
      ['media', colors.media],
      ['edge', colors.edge],
      ['nav-track', colors.navTrack],
      ['hero-art', colors.heroArt],
      ['hero-glow', colors.heroGlow],
      ['hero-ink', colors.heroInk],
      ['footer-band', colors.footerBand],
      ['promo-warm', colors.promoWarm],
      ['promo-cool', colors.promoCool],
      ['spotlight', colors.spotlight],
      ['spotlight-accent', colors.spotlightAccent],
      ...paletteRegions.map((region) => [`area-${region}`, colors.regions[region]]),
      ...colors.lanes.flatMap(({ body, media, ink }, i) => [
        [`tone-${i}-body`, body],
        [`tone-${i}-media`, media],
        [`tone-${i}-ink`, ink],
      ]),
    ].map(([key, value]) => [`--shop-${key}-${theme}`, value]),
  );
}
