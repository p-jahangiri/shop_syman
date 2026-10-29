import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function TableMenu({
  label,
  icon,
  badge,
  iconOnly = false,
  children,
}: {
  label: string;
  icon: ReactNode;
  badge?: number;
  iconOnly?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current)
        ref.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (
        event.key === 'Escape' &&
        ref.current?.open &&
        event.target instanceof Node &&
        ref.current.contains(event.target)
      ) {
        event.preventDefault();
        event.stopPropagation();
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, []);
  return (
    <details className={'record-menu' + (iconOnly ? ' record-menu-icon' : '')} ref={ref}>
      <summary>
        {icon}
        <span className={iconOnly ? 'sr-only' : undefined}>{label}</span>
        {!!badge && <span className="record-menu-badge">{badge.toLocaleString('fa-IR')}</span>}
        {!iconOnly && <ChevronDown size={13} aria-hidden="true" />}
      </summary>
      <div className="record-menu-panel">{children}</div>
    </details>
  );
}
