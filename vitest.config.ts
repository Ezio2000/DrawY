import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['modules/**/*.test.ts','apps/**/*.test.ts'],environment:'node'}});
