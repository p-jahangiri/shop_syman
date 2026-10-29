'use client';
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function CatalogFilterSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="filter-section"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="filter-section-trigger">
        <h3>{title}</h3>
        {summary && (
          <span className="filter-section-value" title={summary}>
            {summary}
          </span>
        )}
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="filter-section-body">{children}</div>
    </details>
  );
}
