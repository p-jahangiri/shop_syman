'use client';
import { useI18n, useStorefront } from '@/components/navigation/locale-provider';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Slot } from '@radix-ui/react-slot';
import { X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode, RefObject } from 'react';
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export function groupNavigation(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
    return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"], [role="radio"]'),
  );
  const index = items.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  const forward =
    getComputedStyle(event.currentTarget).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + ([forward, 'ArrowDown'].includes(event.key) ? 1 : -1) + items.length) %
          items.length;
  event.preventDefault();
  items[next]?.focus();
  items[next]?.click();
}
export function Button({
  asChild,
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: 'primary' | 'outline' | 'ghost';
  ref?: RefObject<HTMLButtonElement | null>;
}) {
  useI18n();
  useStorefront();
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      type={asChild ? undefined : type}
      className={cn('button', `button-${variant}`, className)}
      {...props}
    />
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  drawer = false,
  description,
  restoreFocusRef,
  onCloseFocus,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  drawer?: boolean;
  description?: string;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onCloseFocus?: () => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  useStorefront();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay" />
        <DialogPrimitive.Content
          dir={locale === 'fa' ? 'rtl' : 'ltr'}
          className={cn('modal-content', drawer && 'drawer-content', className)}
          aria-describedby={description ? undefined : undefined}
          onCloseAutoFocus={
            restoreFocusRef || onCloseFocus
              ? (event) => {
                  if (onCloseFocus) {
                    event.preventDefault();
                    onCloseFocus();
                    return;
                  }
                  const target = restoreFocusRef?.current;
                  if (target?.isConnected) {
                    event.preventDefault();
                    target.focus({ preventScroll: true });
                  }
                }
              : undefined
          }
        >
          <div className="modal-heading">
            <DialogPrimitive.Title>{t(title)}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="icon-button" aria-label={t('بستن')}>
              <X size={20} />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className={description ? 'modal-description' : 'sr-only'}>
            {t(description ?? t('اطلاعات و گزینه‌های مربوط به این بخش'))}
          </DialogPrimitive.Description>
          {t(children)}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
