import './schema-runtime';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/700.css';
import '@sayman/design-tokens/tokens.css';
import './style.css';
import '../../storefront/components/ticket-workspace.css';
import './admin-theme.css';
import './admin-workspace.css';
import './admin-table-design.css';
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
// Static App dependencies construct schemas before this module's side effects.
// Loading App after schema-runtime has executed keeps the bundled build jitless too.
void import('./app')
  .then(({ App }) => {
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <QueryClientProvider client={client}>
          <App />
        </QueryClientProvider>
      </React.StrictMode>,
    );
  })
  .catch(() => {
    document.getElementById('root')!.textContent =
      'بارگذاری پنل انجام نشد؛ صفحه را تازه‌سازی کنید.';
  });
