import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // Vitest runs unit tests under src/. The e2e/ tree is owned by
    // Playwright and would crash here ("test.describe was not expected
    // to be called") because @playwright/test wires globals differently.
    exclude: ['node_modules', 'dist', '.next', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
