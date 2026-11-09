'use client';

import { useState } from 'react';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';

export function GuideChecklist({ locale, items }: { locale: Locale; items: readonly string[] }) {
  const [checked, setChecked] = useState<number[]>([]);
  const fa = locale === 'fa';
  const digits = new Intl.NumberFormat(fa ? 'fa-IR' : 'en');
  return (
    <section className="guide-checklist" aria-labelledby="guide-checklist-title">
      <h2 id="guide-checklist-title">{fa ? 'مواردی که بررسی کردم' : 'My completed checks'}</h2>
      <p role="status">
        {fa
          ? `${digits.format(checked.length)} از ${digits.format(items.length)} مورد`
          : `${checked.length} of ${items.length} checked`}
      </p>
      <ul>
        {items.map((item, index) => (
          <li key={item}>
            <label>
              <input
                type="checkbox"
                checked={checked.includes(index)}
                onChange={(event) => {
                  const selected = event.target.checked;
                  setChecked((old) =>
                    selected ? [...old, index] : old.filter((value) => value !== index),
                  );
                }}
              />
              {item}
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="button button-outline"
        disabled={!checked.length}
        onClick={() => setChecked([])}
      >
        {fa ? 'پاک کردن علامت‌ها' : 'Clear all checks'}
      </button>
    </section>
  );
}
