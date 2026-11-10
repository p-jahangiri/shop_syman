import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as reviews from '@sayman/web-shared/lib/reviews/reviews-contract.ts';

test('review submission needs only stars and text, and closes on success', async () => {
  const sent: reviews.SaveReviewInput[] = [];
  let refreshed = false;
  const values = new FormData();
  const ui = digitalUiHarness(
    fileURLToPath(new URL('../components/catalog/product-reviews.tsx', import.meta.url)),
    {
      '../auth/auth-provider': {},
      '../navigation/locale-provider': {},
      '../navigation/localized-link': { default: 'Link' },
      '../shared/ui': { Modal: 'Modal', Button: 'Button' },
      '../reviews/review-votes': { ReviewVoteBar: 'ReviewVoteBar' },
      '../reviews/review-stars': { ReviewStarInput: 'StarInput', ReviewStars: 'Stars' },
      '../reviews/review-photo': { ReviewPhotoInput: 'PhotoInput' },
      '@/lib/checkout/cart-client': { CartError: Error },
      '@/lib/reviews/reviews-client': {
        readOwnReview: async () => null,
        submitReview: async (
          _fetcher: unknown,
          _id: string,
          _command: string,
          input: reviews.SaveReviewInput,
        ) => {
          sent.push(input);
          return { review: { state: 'Pending', content: input } };
        },
      },
      '@sayman/web-shared/lib/reviews/reviews-contract.ts': reviews,
      '../shared/product-community.css': {},
      './product-reviews.css': {},
    },
    {
      FormData: class {
        get(key: string) {
          return values.get(key);
        }
      },
    },
    'export { ReviewEditor };',
  );
  ui.mount('ReviewEditor', {
    productId: 'p1',
    productName: 'گوشی آزمایشی',
    locale: 'fa',
    profileName: 'آوای آزمون',
    fetcher() {},
    onSaved() {
      refreshed = true;
    },
  });
  await ui.settle();
  const open = uiElements(ui.tree()).find(
    (element) => element.type === 'Button' && uiText(element) === 'ثبت دیدگاه',
  );
  assert(open);
  (open.props.onClick as () => void)();
  await ui.settle();
  assert(!uiElements(ui.tree()).some((element) => element.props.name === 'displayName'));
  const select = uiElements(ui.tree()).find(
    (element) => element.type === 'select' && element.props.name === 'identity',
  );
  assert(select);
  assert.equal(select.props.defaultValue, 'anonymous');
  assert.match(uiText(select), /ارسال با نام شما.*آوای آزمون/);
  const submit = () => {
    const form = uiElements(ui.tree()).find((element) => element.type === 'form');
    assert(form);
    (form.props.onSubmit as (event: unknown) => void)({
      preventDefault() {},
      currentTarget: { querySelector: () => null },
    });
  };
  values.set('rating', '5');
  values.set('body', 'کوتاه');
  submit();
  await ui.settle();
  assert.match(uiText(ui.tree()), /۱۰ تا ۲۰۰۰ نویسه/);
  assert.equal(sent.length, 0);
  values.set('identity', 'profile');
  values.set('body', 'کیفیت صفحه و شارژدهی برای استفادهٔ روزمره مناسب بود.');
  submit();
  await ui.settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.displayName, 'آوای آزمون');
  assert.equal(sent[0]!.rating, 5);
  assert.equal(sent[0]!.body, values.get('body'));
  assert.equal(
    uiElements(ui.tree()).find((element) => element.type === 'Modal')?.props.open,
    false,
  );
  assert.match(uiText(ui.tree()), /ویرایش دیدگاه/);
  assert.match(uiText(ui.tree()), /پس از تأیید منتشر می‌شود/);
  assert(refreshed);
});
