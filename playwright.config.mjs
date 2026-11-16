// Browser tests: `npm run test:e2e`. The app is started on a spare port with a throwaway database.
import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 3199);
const DATA_DIR = path.join(os.tmpdir(), `notes-e2e-${Date.now()}`);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: Number(process.env.TEST_WORKERS || 2),
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 }, acceptDownloads: true, actionTimeout: 10_000 },
  webServer: { command: 'node build.mjs && node server.js', url: `http://localhost:${PORT}/`, env: { PORT: String(PORT), DATA_DIR, AUTH_ATTEMPTS_PER_15_MIN: '10000' /* every test signs up its own user */ }, reuseExistingServer: false, timeout: 120_000 },
});
