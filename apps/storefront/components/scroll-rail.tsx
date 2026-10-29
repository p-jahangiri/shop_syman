'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useI18n } from './locale-provider';

/** Native touch/keyboard scrolling; controls are only added when content overflows. */
export function ScrollRail({ children, label }: { children: ReactNode; label: string }) {
  const { locale } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true, overflow: false });

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
      // RTL scrollLeft is negative; clamp elastic overscroll at both ends.
      const position = Math.min(maximum, Math.abs(element.scrollLeft));
      const next = { start: position < 2, end: maximum - position < 2, overflow: maximum > 2 };
      setEdges((previous) =>
        previous.start === next.start &&
        previous.end === next.end &&
        previous.overflow === next.overflow
          ? previous
          : next,
      );
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
    };
  }, [locale, children]);

  function move(forward: boolean) {
    const element = viewport.current;
    if (!element) return;
    const direction = (locale === 'fa' ? -1 : 1) * (forward ? 1 : -1);
    element.scrollBy({
      left: direction * element.clientWidth * 0.8,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }

  return (
    <div className="storefront-rail" data-overflow={edges.overflow}>
      <div
        ref={viewport}
        className="storefront-rail-viewport"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        {children}
      </div>
      {edges.overflow && (
        <div className="storefront-rail-controls">
          <span>{locale === 'fa' ? 'برای دیدن بیشتر ورق بزنید' : 'Scroll to explore more'}</span>
          <button
            type="button"
            disabled={edges.start}
            onClick={() => move(false)}
            aria-label={locale === 'fa' ? 'دسته‌های قبلی' : 'Previous categories'}
          >
            {locale === 'fa' ? <ArrowRight size={17} /> : <ArrowLeft size={17} />}
          </button>
          <button
            type="button"
            disabled={edges.end}
            onClick={() => move(true)}
            aria-label={locale === 'fa' ? 'دسته‌های بعدی' : 'Next categories'}
          >
            {locale === 'fa' ? <ArrowLeft size={17} /> : <ArrowRight size={17} />}
          </button>
        </div>
      )}
    </div>
  );
}
