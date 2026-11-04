import './app/schema-runtime';
import React from 'react';
import { AdminMaterialProvider } from './app/material-provider';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/700.css';
import '@sayman/design-tokens/tokens.css';
import './styles/style.css';
import '@sayman/web-shared/components/support/ticket-workspace.css';
import './styles/admin-theme.css';
import './styles/admin-workspace.css';
import './components/tables/admin-table-design.css';
import './styles/admin-form-design.css';
import './styles/admin-shell.css';
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
// Static App dependencies construct schemas before this module's side effects.
// Loading App after schema-runtime has executed keeps the bundled build jitless too.
void import('./app/app')
  .then(({ App }) => {
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <QueryClientProvider client={client}>
          <AdminMaterialProvider>
            <App />
          </AdminMaterialProvider>
        </QueryClientProvider>
      </React.StrictMode>,
    );
  })
  .catch(() => {
    document.getElementById('root')!.textContent =
      'بارگذاری پنل انجام نشد؛ صفحه را تازه‌سازی کنید.';
  });
