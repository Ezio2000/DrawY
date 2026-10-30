import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['modules/**/*.test.ts','apps/**/*.test.ts','materials/**/*.test.ts'],exclude:['**/node_modules/**'],environment:'node'}});
