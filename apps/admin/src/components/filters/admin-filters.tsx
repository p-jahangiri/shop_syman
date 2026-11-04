import { useEffect, useId, useRef, useState, type FormEventHandler, type ReactNode } from 'react';
import { Search, SlidersHorizontal, ChevronDown } from 'lucide-react';

export function AdminFilters({
  label,
  search,
  primary,
  children,
  actions,
  applied = [],
  inline = false,
}: {
  label: string;
  search?: ReactNode;
  primary?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  applied?: readonly string[];
  inline?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <div className={'admin-filter-layout' + (inline ? ' is-inline' : '')}>
      <div className="admin-filter-main">
        {search ? (
          <div className="admin-filter-search">
            <Search size={19} aria-hidden="true" />
            {search}
          </div>
        ) : (
          <div className="admin-filter-primary">{primary}</div>
        )}
        {children && !inline && (
          <button
            type="button"
            className="admin-filter-toggle"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded((value) => !value)}
          >
            <SlidersHorizontal size={17} aria-hidden="true" />
            فیلترها
            {applied.length > 0 && (
              <span className="filter-count">{applied.length.toLocaleString('fa-IR')}</span>
            )}
            <ChevronDown size={15} className={expanded ? 'rotated' : ''} aria-hidden="true" />
          </button>
        )}
        {actions && <div className="admin-filter-actions">{actions}</div>}
      </div>
      {children && (
        <fieldset className="admin-filter-options" id={id} hidden={!expanded && !inline}>
          <legend className="sr-only">{label}</legend>
          {children}
        </fieldset>
      )}
      {applied.length > 0 && (
        <div className="admin-filter-applied" role="status" aria-label="فیلترهای اعمال‌شده">
          <span>نمایش بر اساس</span>
          {applied.map((item) => (
            <span className="filter-chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminFilterForm({
  onSubmit,
  live = true,
  ...props
}: Parameters<typeof AdminFilters>[0] & {
  onSubmit: FormEventHandler<HTMLFormElement>;
  live?: boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  function schedule(form: HTMLFormElement) {
    clearTimeout(timer.current);
    if (!live || composing.current) return;
    timer.current = setTimeout(() => {
      if (form.isConnected && form.checkValidity()) form.requestSubmit();
    }, 350);
  }
  return (
    <form
      className={'admin-filter-form' + (live ? ' is-live' : '')}
      aria-label={props.label}
      onChange={(event) => schedule(event.currentTarget)}
      onCompositionStart={() => {
        composing.current = true;
        clearTimeout(timer.current);
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        schedule(event.currentTarget);
      }}
      onReset={() => clearTimeout(timer.current)}
      onSubmit={(event) => {
        clearTimeout(timer.current);
        onSubmit(event);
      }}
    >
      <AdminFilters {...props} />
    </form>
  );
}
