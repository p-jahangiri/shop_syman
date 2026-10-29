import { config } from 'zod';
// This side effect runs before App imports construct schemas; never relax CSP.
config({ jitless: true });
