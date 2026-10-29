import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import ts from 'typescript-eslint';
import globals from 'globals';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import accessibility from 'eslint-plugin-jsx-a11y';
import next from '@next/eslint-plugin-next';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    'tmp/**',
    'artifacts/**',
    'backend/**',
    '**/.next*/**',
    '**/dist/**',
    '**/out/**',
    '**/coverage/**',
    '**/next-env.d.ts',
    'apps/storefront/public/sw.js',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    extends: [ts.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['apps/**/*.{jsx,tsx}'],
    extends: [
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
      accessibility.flatConfigs.recommended,
    ],
    settings: { react: { version: '19.3.1' } },
    plugins: { 'react-hooks': hooks },
    rules: {
      // Named scroll regions need keyboard focus so tables work without a pointer.
      'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['region'] }],
      'react/prop-types': 'off', // Props are checked by each application's strict TypeScript build.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['apps/storefront/**/*.{js,mjs,ts,tsx}'],
    plugins: { '@next/next': next },
    settings: { next: { rootDir: 'apps/storefront/' } },
    rules: { ...next.configs.recommended.rules, ...next.configs['core-web-vitals'].rules },
  },
]);
