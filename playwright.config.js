// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * 設定 headless 模式：
 * true 表示無頭模式，false 表示有頭模式
 */
const HEADLESS = true; // 修改為 false 即為有頭模式 true 為無頭

/**
 * 根據環境變數決定要使用的環境
 * 如果沒有設定 ENV，預設使用 'stg' 環境
 */
const ENV = process.env.ENV || 'stg';

let baseURL;
if (ENV === 'prod') {
  baseURL = 'https://prod.yourdomain.com';
} else if (ENV === 'uat') {
  baseURL = 'https://uat.yourdomain.com';
} else {
  baseURL = 'https://stagingop.ggyyonline.com';
}

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
    baseURL, // 根據 ENV 設定 baseURL
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
