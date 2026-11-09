import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpLeft, Clock3, Search, Star, X } from 'lucide-react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import { filteredNavigationGroups, type Page } from './admin-navigation';
import { readRecentAdminPages, type AdminDashboardShortcut } from '../state/admin-ui-preferences';
import '../styles/admin-quick-access.css';

type Props = {
  accountId: string;
  permissions: readonly string[];
  selected: Page;
  pins: readonly AdminDashboardShortcut[];
  onTogglePin: (page: AdminDashboardShortcut) => void;
  onNavigate: (page: Page) => void;
  onClose: () => void;
};

export function AdminQuickAccess({
  accountId,
  permissions,
  selected,
  pins,
  onTogglePin,
  onNavigate,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [recent] = useState(() => readRecentAdminPages(accountId));
  const title = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const groups = filteredNavigationGroups(permissions, query);
  const items = new Map(
    groups.flatMap((group) =>
      group.items.map((item) => [item.id, { ...item, group: group.label }]),
    ),
  );
  function suggestions(ids: readonly Page[]) {
    return ids.flatMap((id) => {
      const item = items.get(id);
      return item ? [item] : [];
    });
  }
  const searching = !!query.trim();
  const pinned = searching ? [] : suggestions(pins);
  const latest = searching ? [] : suggestions(recent.filter((page) => page !== selected));
  const suggested = new Set([...pinned, ...latest].map((item) => item.id));
  const sections = [
    { id: 'pinned', label: 'منتخب‌ها', items: pinned },
    { id: 'recent', label: 'اخیراً بازشده', items: latest },
    ...groups.map((group) => ({
      id: group.id,
      label: group.label,
      items: suggestions(group.items.map((item) => item.id).filter((id) => !suggested.has(id))),
    })),
  ].filter((section) => section.items.length);

  const links = () =>
    Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[data-open-page]') ?? []);
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = links();
    const next = buttons.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1);
    event.preventDefault();
    if (next < 0) input.current?.focus();
    else buttons[next]?.focus();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby={title}
      disableRestoreFocus
      slotProps={{
        paper: { className: 'admin-finder' },
        transition: { onEntered: () => input.current?.focus() },
      }}
    >
      <DialogTitle id={title} className="admin-finder-title">
        <span>
          <Search size={19} aria-hidden="true" /> رفتن به بخش
        </span>
        <button type="button" className="icon" aria-label="بستن جست‌وجوی پنل" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </DialogTitle>
      <div className="admin-finder-search">
        <Search size={19} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          aria-label="نام بخش یا کار موردنظر"
          placeholder="مثلاً موجودی، مرجوعی یا ظاهر سایت"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              links()[0]?.focus();
            } else if (event.key === 'Enter' && searching) {
              event.preventDefault();
              links()[0]?.click();
            }
          }}
        />
      </div>
      <div className="admin-finder-results" ref={list}>
        {sections.map((section) => (
          <section key={section.id} aria-label={section.label}>
            <h2>
              {section.id === 'recent' && <Clock3 size={14} aria-hidden="true" />}
              {section.label}
            </h2>
            <ul>
              {section.items.map((item) => {
                const pinned = item.id !== 'dashboard' && pins.includes(item.id);
                return (
                  <li className="admin-finder-row" key={item.id}>
                    <button
                      type="button"
                      className="admin-finder-open"
                      data-open-page={item.id}
                      onClick={() => onNavigate(item.id)}
                      onKeyDown={moveFocus}
                      aria-current={item.id === selected ? 'page' : undefined}
                    >
                      <span className="admin-finder-page-icon">
                        <item.icon size={18} aria-hidden="true" />
                      </span>
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.group}</small>
                      </span>
                      <ArrowUpLeft size={16} aria-hidden="true" className="admin-finder-arrow" />
                    </button>
                    {item.id !== 'dashboard' && (
                      <button
                        type="button"
                        className="icon admin-finder-pin"
                        data-pin-page={item.id}
                        aria-label={`منتخب‌ها، ${item.label}`}
                        aria-pressed={pinned}
                        title={pinned ? 'برداشتن از منتخب‌ها' : 'افزودن به منتخب‌ها'}
                        onClick={() => {
                          if (item.id === 'dashboard') return;
                          onTogglePin(item.id);
                          requestAnimationFrame(() => {
                            if (list.current?.contains(document.activeElement)) return;
                            list.current
                              ?.querySelector<HTMLButtonElement>(`[data-pin-page="${item.id}"]`)
                              ?.focus();
                          });
                        }}
                      >
                        <Star
                          size={18}
                          fill={pinned ? 'currentColor' : 'none'}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {!sections.length && (
          <p className="admin-finder-empty" role="status">
            بخشی با این عبارت پیدا نشد.
          </p>
        )}
      </div>
      <p className="admin-finder-hint">
        با ستاره، بخش‌های پرکاربرد را به بالای داشبورد اضافه کنید.
      </p>
    </Dialog>
  );
}
