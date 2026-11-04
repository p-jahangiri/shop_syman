import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // The picker is hoisted; resolve its optional Jalali peer from this workspace.
  resolve: { dedupe: ['date-fns-jalali'] },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.ADMIN_API_URL ?? 'http://127.0.0.1:5080', changeOrigin: true },
      '/health': {
        target: process.env.ADMIN_API_URL ?? 'http://127.0.0.1:5080',
        changeOrigin: true,
      },
    },
  },
  preview: { host: '127.0.0.1', port: 5173 },
  build: {
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-core',
              test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
            },
            { name: 'data-client', test: /[\\/]node_modules[\\/]@tanstack[\\/]/ },
            {
              name: 'forms-and-schema',
              test: /[\\/]node_modules[\\/](?:zod|react-hook-form|@hookform)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
