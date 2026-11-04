'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import Link, { usePathname } from './localized-link';
import type { MenuItem } from '@sayman/web-shared/lib/shared/types.ts';

type MenuOptions = {
  onNavigate?: () => void;
  iconFor?: (item: MenuItem) => ReactNode;
};

function MenuItemLabel({ item, iconFor }: Pick<MenuOptions, 'iconFor'> & { item: MenuItem }) {
  if (!iconFor) return item.label;
  return (
    <>
      <span className="category-menu-icon" aria-hidden="true">
        {iconFor(item)}
      </span>
      <span className="category-menu-label">{item.label}</span>
    </>
  );
}

function MenuBranch({ item, onNavigate, iconFor }: MenuOptions & { item: MenuItem }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current && !ref.current.contains(event.target))
        ref.current.open = false;
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        event.target instanceof Element &&
        event.target.closest('details.content-menu') === ref.current &&
        ref.current
      ) {
        event.preventDefault();
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }
    };
    const closeOnFocusOut = (event: FocusEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        ref.current &&
        !ref.current.contains(event.relatedTarget)
      )
        ref.current.open = false;
    };
    const element = ref.current;
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithKeyboard);
    element?.addEventListener('focusout', closeOnFocusOut);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithKeyboard);
      element?.removeEventListener('focusout', closeOnFocusOut);
    };
  }, [open]);
  function navigate() {
    if (ref.current) ref.current.open = false;
    onNavigate?.();
  }
  return (
    <details
      ref={ref}
      className="content-menu"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <MenuItemLabel item={item} iconFor={iconFor} />
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div className="content-submenu">
        <Link href={item.href} onClick={navigate}>
          <MenuItemLabel item={item} iconFor={iconFor} />
        </Link>
        <ContentMenu items={item.children ?? []} onNavigate={navigate} iconFor={iconFor} />
      </div>
    </details>
  );
}

export function ContentMenu({ items, onNavigate, iconFor }: MenuOptions & { items: MenuItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item, index) =>
        item.children?.length ? (
          <MenuBranch
            key={`${item.href}:${index}`}
            item={item}
            onNavigate={onNavigate}
            iconFor={iconFor}
          />
        ) : (
          <Link
            key={`${item.href}:${index}`}
            href={item.href}
            aria-current={!item.href.includes('?') && pathname === item.href ? 'page' : undefined}
            onClick={onNavigate}
          >
            <MenuItemLabel item={item} iconFor={iconFor} />
          </Link>
        ),
      )}
    </>
  );
}
