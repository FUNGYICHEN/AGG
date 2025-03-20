import { test, expect } from '@playwright/test';
import { ENV_CONFIG, generateGameUrl } from './api-config.js';

test('Canvas相對座標 (iframe版)', async ({ browser, request }) => {
  test.setTimeout(0);

  // 選擇單一 agent 與遊戲ID（範例使用 agent 10101 與 game_id 20053）
  const agent = 10101;
  const game_id = 20053; // 若 game_id >= 20000，則使用 "#game_canvas"

  // 取得遊戲 URL
  const game_url = await generateGameUrl(request, agent, game_id);
  console.log(`取得的 URL: ${game_url}`);

  // 建立 context 與 page
  const context = await browser.newContext();
  const page = await context.newPage();

  // 進入頁面
  await page.goto(game_url, { waitUntil: 'load' });
  await page.waitForTimeout(7000);

  // 取得名稱為 "game" 的 iframe
  const frame = await page.frame({ name: 'game' });
  if (!frame) {
    throw new Error('找不到名稱為 "game" 的 iframe');
  }
  console.log("找到 iframe，URL:", frame.url());

  // 根據 game_id 決定 canvas 選擇器：
  // 若 game_id >= 20000 則使用 "#game_canvas"
  let canvasSelector = game_id >= 20000 ? '#game_canvas' : '#layaCanvas';
  console.log(`使用的 canvas 選擇器：${canvasSelector}`);

  // 等待 canvas 出現在 iframe 內（等待最多 60 秒）
  await frame.waitForSelector(canvasSelector, { timeout: 60000 });
  const canvas = await frame.$(canvasSelector);
  if (!canvas) {
    throw new Error("找不到遊戲 canvas");
  }
  const box = await canvas.boundingBox();
  console.log(`Canvas bounding box: ${JSON.stringify(box)}`);

  // 暴露 Node 函式讓瀏覽器端呼叫
  await page.exposeFunction('reportMouseCoordinates', (x, y) => {
    console.log(`滑鼠相對於Canvas的位置：x=${x}, y=${y}`);
  });

  // 在 iframe 中注入監聽事件，取得滑鼠相對於 canvas 的位置
  await frame.evaluate((selector) => {
    const canvas = document.querySelector(selector);
    if (!canvas) return;
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      window.reportMouseCoordinates(x, y);
    });
  }, canvasSelector);

  // 保持頁面打開一段時間以便觀察 console log
  await page.waitForTimeout(1000000);
  await context.close();
});