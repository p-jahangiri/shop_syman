import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, LogOut, Search, ShieldCheck, X } from 'lucide-react';
import { filteredNavigationGroups, type Page } from './admin-navigation';
import { AdminBrandIdentity } from './admin-brand';

type Props = {
  selected: Page;
  permissions: readonly string[];
  open: boolean;
  onClose: () => void;
  displayName: string;
  onLogout: () => void;
  onNavigate: (page: Page) => void;
};

export function AdminNavigation(props: Props) {
  return (
    <>
      <aside className="sidebar" aria-label="فهرست مدیریت سایمان">
        <NavigationContent {...props} />
      </aside>
      {props.open && <MobileNavigation {...props} />}
    </>
  );
}

function MobileNavigation(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Native Escape handling is provided by onCancel; this click handler only dismisses the backdrop.
    <dialog
      ref={ref}
      id="admin-navigation"
      className="admin-menu-dialog"
      aria-label="فهرست مدیریت سایمان"
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <NavigationContent {...props} mobile />
    </dialog>
  );
}

function NavigationContent({
  selected,
  permissions,
  displayName,
  onNavigate,
  onLogout,
  onClose,
  mobile = false,
}: Props & { mobile?: boolean }) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const groups = filteredNavigationGroups(permissions, query);
  return (
    <div className="admin-navigation-content">
      <div className="admin-brand-row">
        <button
          type="button"
          className="admin-brand"
          aria-label="سایمان؛ نمای کلی"
          onClick={() => onNavigate('dashboard')}
        >
          <AdminBrandIdentity />
        </button>
        {mobile && (
          <button type="button" className="icon" aria-label="بستن منو" onClick={onClose}>
            <X size={20} />
          </button>
        )}
      </div>
      <div className="admin-nav-search">
        <label className="sr-only" htmlFor={searchId}>
          جست‌وجوی بخش‌های پنل
        </label>
        <Search size={17} aria-hidden="true" />
        <input
          id={searchId}
          type="search"
          placeholder="جست‌وجوی بخش‌ها…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <nav aria-label="بخش‌های پنل">
        {groups.map((group) => (
          <section className="admin-nav-group" key={group.id} aria-label={group.label}>
            <h2>{group.label}</h2>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={selected === item.id ? 'active' : ''}
                aria-current={selected === item.id ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <item.icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
                {selected === item.id && (
                  <ChevronLeft size={15} className="admin-nav-current" aria-hidden="true" />
                )}
              </button>
            ))}
          </section>
        ))}
        {!groups.length && (
          <div className="admin-nav-empty" role="status">
            <p>بخشی با این نام پیدا نشد.</p>
            <button type="button" onClick={() => setQuery('')}>
              پاک‌کردن جست‌وجو
            </button>
          </div>
        )}
      </nav>
      <div className="sidebar-bottom">
        <span className="avatar" aria-hidden="true">
          {Array.from(displayName)[0] || 'م'}
        </span>
        <div>
          <strong>{displayName}</strong>
          <small>
            <ShieldCheck size={12} aria-hidden="true" />
            ورود دومرحله‌ای
          </small>
        </div>
        <button type="button" className="icon" onClick={onLogout} aria-label="خروج از حساب">
          <LogOut size={18} />
        </button>
      </div>
    </div>
  );
}
