import {
  cloneElement,
  isValidElement,
  Component,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { X, LoaderCircle, AlertCircle } from 'lucide-react';
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div className="error" role="alert">
      <AlertCircle size={18} />
      <span>{error instanceof Error ? error.message : 'عملیات انجام نشد.'}</span>
    </div>
  ) : null;
}
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="panel" role="alert">
        <h2>بارگیری این بخش کامل نشد</h2>
        <p>
          برای دریافت نسخهٔ تازه، پنل را دوباره بارگیری کنید. اطلاعات ذخیره‌نشدهٔ فرم با بارگیری
          مجدد پاک می‌شود.
        </p>
        <button className="primary" onClick={() => window.location.reload()}>
          بارگیری مجدد پنل
        </button>
        <p>از منوی کناری هم می‌توانید بخش دیگری را باز کنید.</p>
      </section>
    ) : (
      this.props.children
    );
  }
}
export function Busy() {
  return (
    <div className="busy" role="status">
      <LoaderCircle className="spin" size={20} />
      در حال دریافت اطلاعات…
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
  error,
  required = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  const generatedId = useId();
  const control =
    isValidElement<React.InputHTMLAttributes<HTMLInputElement>>(children) &&
    typeof children.type === 'string' &&
    ['input', 'select', 'textarea'].includes(children.type)
      ? children
      : null;
  const controlId = control?.props.id ?? generatedId;
  return (
    <label
      className={'field' + (error ? ' field-invalid' : '')}
      htmlFor={control ? controlId : undefined}
    >
      <span>
        {label}
        {(required || control?.props.required) && (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {control
        ? cloneElement(control, {
            id: controlId,
            name: control.props.name ?? controlId,
            required: required || control.props.required,
            'aria-invalid': error ? true : control.props['aria-invalid'],
            'aria-describedby':
              [
                control.props['aria-describedby'],
                hint ? controlId + '-hint' : null,
                error ? controlId + '-error' : null,
              ]
                .filter(Boolean)
                .join(' ') || undefined,
          })
        : children}
      {hint && <small id={controlId + '-hint'}>{hint}</small>}
      {error && (
        <small className="field-error" id={controlId + '-error'} role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
export function Check({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="check">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
  preventClose = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  preventClose?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const active = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (active instanceof HTMLElement && active.isConnected)
        active.focus({ preventScroll: true });
    };
  }, []);
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Native Escape handling is provided by onCancel; this click handler only dismisses the backdrop.
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (preventClose) e.preventDefault();
        else onClose();
      }}
      onClick={(e) => {
        if (!preventClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon"
          onClick={onClose}
          disabled={preventClose}
          aria-label="بستن"
        >
          <X size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
