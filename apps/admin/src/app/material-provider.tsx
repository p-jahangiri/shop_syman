import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { faIR as coreFa } from '@mui/material/locale';
import { faIR as gridFa } from '@mui/x-data-grid/locales';
import { faIR as pickerFa } from '@mui/x-date-pickers/locales';
import rtlPlugin from '@mui/stylis-plugin-rtl';
import { prefixer } from 'stylis';
import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { AdminColorModeContext } from '../hooks/admin-color-mode';
import { adminStyleNonce } from './admin-style-nonce';
import {
  readAdminColorMode,
  writeAdminColorMode,
  type AdminColorMode,
} from '../state/admin-ui-preferences';

const cache = createCache({
  key: 'sayman-rtl',
  nonce: adminStyleNonce(),
  stylisPlugins: [prefixer, rtlPlugin],
});

function buildTheme(mode: AdminColorMode) {
  const dark = mode === 'dark';
  return createTheme(
    {
      direction: 'rtl',
      typography: {
        fontFamily: 'Vazirmatn, sans-serif',
        fontSize: 14,
        button: { textTransform: 'none', fontWeight: 600 },
      },
      palette: {
        mode,
        primary: {
          main: dark ? '#b8cc93' : '#41552f',
          dark: dark ? '#d0e2ad' : '#324524',
          contrastText: dark ? '#202716' : '#fff',
        },
        secondary: { main: dark ? '#bac2a8' : '#6c765b' },
        error: {
          main: dark ? '#ffaaa0' : '#a62d26',
          dark: dark ? '#ffc1b9' : '#8b211a',
          contrastText: dark ? '#331812' : '#fff',
        },
        success: { main: dark ? '#a7cd92' : '#366347' },
        warning: { main: dark ? '#e7bd81' : '#8b5917' },
        action: {
          disabled: dark ? '#a5afa0' : '#626d5d',
          disabledBackground: dark ? '#30392d' : '#e9eee5',
        },
        background: {
          default: dark ? '#181c17' : '#f4f6f1',
          paper: dark ? '#222820' : '#fff',
        },
        text: {
          primary: dark ? '#edf0e7' : '#222a20',
          secondary: dark ? '#b8c1b2' : '#586654',
        },
        divider: dark ? '#424c3e' : '#dce4d8',
      },
      shape: { borderRadius: 12 },
      components: {
        MuiButtonBase: {
          styleOverrides: {
            root: {
              '&.Mui-focusVisible': {
                outline: '2px solid var(--primary)',
                outlineOffset: 3,
              },
            },
          },
        },
        MuiButton: {
          defaultProps: { disableElevation: true },
          styleOverrides: { root: { minHeight: 44, borderRadius: 10 } },
        },
        MuiTextField: { defaultProps: { fullWidth: true, size: 'small', variant: 'outlined' } },
        MuiInputBase: {
          styleOverrides: {
            input: {
              fontSize: '1rem',
              '&.Mui-disabled': { WebkitTextFillColor: 'var(--admin-control-disabled)' },
            },
          },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: {
              minHeight: 46,
              backgroundColor: 'var(--admin-field-surface)',
              borderRadius: 11,
              '&:hover:not(.Mui-disabled, .Mui-error, .Mui-focused) .MuiOutlinedInput-notchedOutline':
                { borderColor: 'var(--primary)' },
              '&.Mui-focused': { boxShadow: '0 0 0 3px var(--admin-focus-halo)' },
              '&.Mui-error.Mui-focused': {
                boxShadow: '0 0 0 3px color-mix(in oklch, var(--danger) 20%, transparent)',
              },
              '&.Mui-disabled, &:has(input[readonly], textarea[readonly])': {
                backgroundColor: 'var(--surface-soft)',
              },
            },
            notchedOutline: { borderColor: 'var(--admin-field-border)' },
          },
        },
        MuiFormHelperText: { styleOverrides: { root: { marginInline: 0, lineHeight: 1.8 } } },
        MuiMenuItem: {
          styleOverrides: { root: { minHeight: '44px !important', fontSize: '0.875rem' } },
        },
        MuiPopover: {
          styleOverrides: {
            paper: { backgroundImage: 'none', border: '1px solid var(--border)' },
          },
        },
        MuiDialog: {
          defaultProps: { fullWidth: true, maxWidth: 'lg' },
          styleOverrides: {
            paper: {
              borderRadius: 20,
              backgroundImage: 'none',
              border: '1px solid var(--border)',
            },
          },
        },
        MuiDialogTitle: {
          styleOverrides: { root: { fontWeight: 750, lineHeight: 1.65 } },
        },
        MuiTooltip: {
          defaultProps: { arrow: true },
          styleOverrides: { tooltip: { fontSize: 12, lineHeight: 1.8 } },
        },
      },
    },
    coreFa,
    gridFa,
    pickerFa,
  );
}

export function AdminMaterialProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState(readAdminColorMode);
  const theme = useMemo(() => buildTheme(mode), [mode]);
  const toggle = useCallback(() => setMode((value) => (value === 'dark' ? 'light' : 'dark')), []);
  const context = useMemo(() => ({ mode, toggle }), [mode, toggle]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode;
    writeAdminColorMode(mode);
  }, [mode]);

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <AdminColorModeContext.Provider value={context}>{children}</AdminColorModeContext.Provider>
      </ThemeProvider>
    </CacheProvider>
  );
}
