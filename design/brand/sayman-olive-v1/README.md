# Sayman — approved olive identity v1

Owner selection: concept 01, olive/minimal, on 2026-10-29 (D54).

The original exploration is in `../../brand-exploration-2026-10-29/01-olive-ribbon.png`. The approved S mark was extracted with the built-in image_gen tool. `master-transparent.png` is the unmodified generated RGBA master. This delivery is raster PNG; no editable vector/SVG master is claimed.

Mechanical asset preparation uses Sharp: trim transparent margins, fit within 448×448, add 32px transparent padding on all sides, encode PNG. This yields `apps/storefront/public/products/sayman-mark-olive-v1.png` at 512×512. The Vite admin shares this public directory. The generated pixels retain the approved mark; no browser filter changes its colors.

Brand palette: olive `#425B36`, ivory `#F6F4EC`; existing dark-theme primary `#B9CF9E` remains available for live text. Put the olive mark on the ivory tile on dark backgrounds. Keep the Persian/English name as live text using the existing Vazirmatn/font settings, so it remains legible, accessible and editable from storefront CMS.

Derived assets:

- `public/favicon-32.png` and `public/favicon-192.png`: ivory-backed browser icons.
- `public/pwa/icons/sayman-olive-v1-{180,192,512}.png`: Apple/PWA icons, same mark and ivory background. The maskable 512px canvas gives generous safe padding.
- PWA locale endpoints remain `/pwa/icons/{fa|en}/{180|192|512}.png`.

The storefront respects a nonempty CMS `site.logoUrl`; the approved mark is also the empty-setting fallback. Admin navigation/login and the offline shell use the bundled identity. Changing the storefront CMS logo does not silently rebuild installed app icons or admin branding.

## Exact extraction prompt

Reference: the approved concept 01 image. Built-in edit mode, `transparent_background: true`.

```text
Use case: background-extraction / logo-brand. Edit the supplied owner-approved SAYMAN logo concept. Extract ONLY the large olive-green emblem at the top, remove the entire SAYMAN wordmark and all ivory background. Preserve the approved emblem's exact outline and two curved negative-space channels: one compact rounded-square capital-S ribbon mark with its small pointed terminations. Do not redesign or add strokes. A perfectly flat single solid dark olive #425B36 foreground, no lighting, gradients, texture or shadow. Both cutout channels are genuinely transparent, as is all background. Center the complete mark in a square high-resolution image with 10% clear padding around its bounding box, never cropped. No text or additional objects. This is the final clean mark to place next to live Persian/English brand text in a storefront, admin and small app icons.
```
