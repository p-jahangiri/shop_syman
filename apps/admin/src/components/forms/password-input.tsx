import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function PasswordInput(props: Omit<ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  return (
    <div className="password-control">
      <div className="password-control-row">
        <input
          {...props}
          type={visible ? 'text' : 'password'}
          dir="ltr"
          spellCheck={false}
          autoCapitalize="off"
          onKeyUp={(event) => {
            setCapsLock(event.getModifierState('CapsLock'));
            props.onKeyUp?.(event);
          }}
          onBlur={(event) => {
            setCapsLock(false);
            props.onBlur?.(event);
          }}
        />
        <button
          type="button"
          className="password-visibility"
          aria-label={visible ? 'پنهان‌کردن رمز' : 'نمایش رمز'}
          aria-pressed={visible}
          disabled={props.disabled}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
      {capsLock && <small role="status">کلید Caps Lock روشن است.</small>}
    </div>
  );
}
