import { defineConfig, devices } from '@playwright/test'

/**
 * 無頭模式設定：
 * true 代表無頭模式；false 代表有頭模式
 */
const HEADLESS = true;

export default defineConfig({
  timeout: 0,              // 全域不設超時
  testDir: './tests',      // 測試目錄
  fullyParallel: true,     // 支援平行執行
  forbidOnly: false,       // 是否禁止使用 test.only
  retries: 0,              // 失敗後重試次數
  workers: 4,              // 工作緒數量
  // 同時使用 JSON 與 HTML reporter
  // JSON 報告會輸出到 report.json，HTML 報告放在 playwright-report 目錄下
  reporter: [
    ['json', { outputFile: 'report.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
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
