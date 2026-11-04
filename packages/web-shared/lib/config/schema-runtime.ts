import { z } from 'zod';

// Validation must work without Function/eval under the storefront script CSP.
z.config({ jitless: true });
export * from 'zod';
