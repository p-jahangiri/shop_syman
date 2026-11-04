import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as paths from '@sayman/web-shared/lib/media/media-paths.ts';
import {
  digitalUiHarness,
  uiElements,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
for (const locale of ['fa', 'en'] as const)
  test(`actual ${locale} historical inspection gallery uses recorded alternatives, explicit zoom and admin-only preview prefix`, async () => {
    let opened = 0,
      closed = 0;
    class Element {
      isConnected = true;
      focus() {}
    }
    const h = digitalUiHarness(
      fileURLToPath(
        new URL(
          '../../../packages/web-shared/components/catalog/used-condition-gallery.tsx',
          import.meta.url,
        ),
      ),
      { '../../lib/media/media-paths': paths },
      { document: { activeElement: new Element() }, HTMLElement: Element },
    );
    const photos = [
      {
        url: '/media/catalog/' + 'a'.repeat(32) + '/card.webp',
        altFa: 'عکس همان دستگاه',
        altEn: 'Recorded unit photo',
      },
      {
        url: '/media/catalog/' + 'b'.repeat(32) + '/card.webp',
        altFa: 'صفحهٔ همان دستگاه',
        altEn: 'Recorded unit screen',
      },
    ];
    h.mount('UsedConditionGallery', { photos, locale, mediaPrefix: '/api' });
    const dialog = uiElements(h.tree()).find((n) => n.type === 'dialog')!;
    (dialog.props.ref as { current: unknown }).current = {
      showModal() {
        opened++;
      },
      close() {
        closed++;
      },
    };
    await h.settle();
    const images = uiElements(h.tree()).filter((n) => n.type === 'img');
    assert.equal(images.length, 2);
    assert.equal(images[0].props.src, '/api' + paths.publicImageVariant(photos[0].url, 'thumb'));
    assert.equal(images[0].props.alt, locale === 'fa' ? photos[0].altFa : photos[0].altEn);
    (uiElements(h.tree()).filter((n) => n.type === 'button')[1].props.onClick as () => void)();
    await h.settle();
    assert.equal(opened, 1);
    assert.ok(
      uiElements(h.tree()).some(
        (n) =>
          n.type === 'img' &&
          n.props.src === '/api' + paths.publicImageVariant(photos[1].url, 'zoom'),
      ),
    );
    (uiElements(h.tree()).find((n) => n.type === 'dialog')!.props.onCancel as () => void)();
    await h.settle();
    assert.equal(uiElements(h.tree()).filter((n) => n.type === 'img').length, 2);
    assert.ok(closed > 0);
    h.unmount();
  });
