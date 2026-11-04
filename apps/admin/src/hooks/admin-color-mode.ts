import { createContext, useContext } from 'react';
import type { AdminColorMode } from '../state/admin-ui-preferences';

export const AdminColorModeContext = createContext<{
  mode: AdminColorMode;
  toggle: () => void;
}>({ mode: 'light', toggle() {} });

export function useAdminColorMode() {
  return useContext(AdminColorModeContext);
}
