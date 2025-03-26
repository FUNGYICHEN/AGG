// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * 設定 headless 模式：
 * true 表示無頭模式，false 表示有頭模式
 */
const HEADLESS = true; // 修改為 false 即為有頭模式 true 為無頭



export default defineConfig({
  timeout: 0, // 全域不設超時
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: false,
  retries: 0,
  workers: 4,
  reporter: 'html',
  
  use: {
    headless: HEADLESS,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
