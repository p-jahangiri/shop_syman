import type { SitePalette } from './site-palette.ts';

export const paletteHarmonies = ['analogous', 'complementary', 'triadic'] as const;
export const neutralTemperatures = ['cool', 'neutral', 'warm'] as const;
type Harmony = (typeof paletteHarmonies)[number];
type Temperature = (typeof neutralTemperatures)[number];
type Vector = [number, number, number];

// The transforms use the D65 OKLab matrices from CSS Color 4. Store fitted
// six-digit sRGB colors so every renderer and the CMS validate the same values.
function toOklch(hex: string): Vector {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const y = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    Math.hypot(a, y),
    Math.atan2(y, a),
  ];
}

function linearRgb(lightness: number, chroma: number, radians: number): Vector {
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function fittedHex(lightness: number, chroma: number, radians: number) {
  let low = 0;
  let high = chroma;
  for (let step = 0; step < 18; step++) {
    const middle = (low + high) / 2;
    if (linearRgb(lightness, middle, radians).every((channel) => channel >= 0 && channel <= 1))
      low = middle;
    else high = middle;
  }
  return (
    '#' +
    linearRgb(lightness, low, radians)
      .map((channel) => {
        const bounded = Math.min(1, Math.max(0, channel));
        const encoded =
          bounded <= 0.0031308 ? 12.92 * bounded : 1.055 * bounded ** (1 / 2.4) - 0.055;
        return Math.round(255 * encoded)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

const offsets: Record<Harmony, [number, number]> = {
  analogous: [-30, 30],
  complementary: [180, 0],
  triadic: [120, 240],
};
const neutrals: Record<Temperature, [number, number]> = {
  cool: [245, 0.022],
  neutral: [90, 0.008],
  warm: [70, 0.025],
};
const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function generateDesignPalette(
  brand: string,
  harmony: Harmony,
  temperature: Temperature,
): SitePalette {
  if (!/^#[0-9a-f]{6}$/i.test(brand)) throw new RangeError('Expected a six-digit brand color.');
  const [lightness, chroma, measuredHue] = toOklch(brand);
  const [neutralHue, neutralChroma] = neutrals[temperature];
  const hue = chroma > 0.002 ? measuredHue : radians(neutralHue);
  const [near, accent] = offsets[harmony].map((degrees) => hue + radians(degrees));
  const tint = Math.min(0.12, Math.max(0.025, chroma));
  const themed = (light: number, dark: number, c: number, h: number) => ({
    light: fittedHex(light, c, h),
    dark: fittedHex(dark, c, h),
  });
  return {
    primaryLight: fittedHex(Math.min(0.57, Math.max(0.35, lightness)), chroma, hue),
    primaryDark: fittedHex(Math.min(0.85, Math.max(0.69, lightness)), chroma, hue),
    heroLight: fittedHex(0.88, tint, near),
    heroDark: fittedHex(0.35, tint, near),
    intensity: 'balanced',
    sections: {
      canvas: themed(0.975, 0.17, neutralChroma, radians(neutralHue)),
      navigation: themed(0.93, 0.28, tint * 0.45, near),
      cards: themed(0.95, 0.26, tint * 0.32, hue),
      promotions: themed(0.87, 0.39, tint, accent),
      footer: themed(0.88, 0.26, neutralChroma * 1.3, radians(neutralHue)),
    },
  };
}
