import { test } from '@playwright/test';

const env = process.env.NODE_ENV || 'stg';
const { ENV_CONFIG, generateGameUrl,depositMoney } = await import(`./${env}環境.js`);
test.describe.configure({ mode: 'serial' });

test('Playson Spin 測試', async ({ browser, request }) => {
  test.setTimeout(0);
  const { expected_Playson, accountPrefix } = ENV_CONFIG; // 例如 "https://static-stage.rowzone.tech/"

  // 測試的遊戲 ID 列表：20051 ~ 20059
  const gameIds = [20051, 20053, 20054, 20055, 20056, 20057, 20058, 20059];

  // 原始 agent 基本清單（不含前綴）
  const baseAgents = [
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
    111, 112, 113, 114, 115, 116, 118, 119, 120, 121,
    122, 123, 124, 125, 126, 127, 128, 129, 130, 131,
    132, 133, 134, 135, 136, 137, 139, 140, 141, 142,
    143, 144, 145, 146, 147, 148, 149, 150, 151, 152,
    153, 154, 155, 156, 157, 158, 159, 161, 162, 165,
    167, 168, 169, 170, 171, 172
  ];
  // 建立 "11" 與 "10" 前綴的 agent 清單
  const agents11 = baseAgents.map(a => parseInt("11" + a.toString()));
  const agents10 = baseAgents.map(a => parseInt("10" + a.toString()));
  const agents = [...agents11, ...agents10];

  let errorMessages = [];

  // 定義整體 session 重試上限
  const maxSessionAttempts = 3;

  for (const agent of agents) {
    for (const gameId of gameIds) {
      let sessionAttempt = 0;
      let spinSuccess = false;
      let lastError = null;
      // 外層 loop：若失敗就重新取得 URL、重新進入遊戲，再嘗試 Spin
      while (sessionAttempt < maxSessionAttempts && !spinSuccess) {
        let context;
        try {
          // 重新取得遊戲 URL
          const game_url = await generateGameUrl(request, agent, gameId);
          if (!game_url.startsWith(expected_Playson)) {
            throw new Error(`URL 前綴不符 -> ${game_url}`);
          }

          // 判斷是否需要打錢包（若 agent 在 11101～11172 範圍內則 deposit 10000）
          const ACCOUNT = `${accountPrefix}${agent}${gameId}`;
          console.log(`下注帳號: ${ACCOUNT}`);
          let depositAmount = 0;
          if (agent >= 11101 && agent <= 11172) {
            depositAmount = 10000;
          }
          if (depositAmount > 0 && sessionAttempt === 0) {
            // 僅在第一次 session 執行時打錢包，避免重複 deposit
            await depositMoney(request, ACCOUNT, agent, depositAmount);
          }

          // 建立新的 browser context 與 page
          context = await browser.newContext({ headless: true });
          const page = await context.newPage();

          // 預先等待 "connection opened" 訊息
          const connectionOpenedPromise = new Promise(resolve => {
            page.on('console', msg => {
              if (msg.text().includes("connection opened")) {
                resolve();
              }
            });
          });

          await page.goto(game_url, { waitUntil: 'load' });
          await page.waitForLoadState('networkidle');
          await Promise.race([
            connectionOpenedPromise,
            page.waitForTimeout(10000)
          ]);

          // 取得 iframe
          const frame = page.frame({ name: 'game' });
          if (!frame) {
            throw new Error("找不到名稱為 'game' 的 iframe");
          }

          // 取得 canvas（Playson 的 canvas id 為 "game_canvas"）
          const canvas = await frame.waitForSelector('#game_canvas', { state: 'visible', timeout: 10000 });
          if (!canvas) {
            throw new Error("找不到遊戲 canvas");
          }
          const box = await canvas.boundingBox();
          if (!box) {
            throw new Error("無法取得 canvas bounding box");
          }

          // 進入遊戲重試機制：最多嘗試 3 次
          const enterX = box.x + 636;
          const enterY = box.y + 638;
          let gameEntered = false;
          for (let attempt = 0; attempt < 3 && !gameEntered; attempt++) {
            await page.mouse.click(enterX, enterY);
            await page.waitForTimeout(2000);
            try {
              await Promise.any([
                frame.waitForSelector('#game_canvas', { state: 'visible', timeout: 5000 }),
                frame.waitForSelector('#game', { state: 'visible', timeout: 5000 })
              ]);
              gameEntered = true;
            } catch (err) {
              console.log(`進入遊戲失敗, 第 ${attempt + 1} 次嘗試，重新點擊進入遊戲`);
              if (attempt === 2) {
                throw new Error("連續嘗試進入遊戲均失敗");
              }
            }
          }

          // Spin 按鈕重試機制：單一 session 中最多嘗試 3 次（初次嘗試 + 2 次重試）
          const spinX = box.x + 1180;
          const spinY = box.y + 318;
          let spinAttempts = 0;
          const maxSpinAttempts = 3;
          while (spinAttempts < maxSpinAttempts && !spinSuccess) {
            const spinResponsePromise = page.waitForResponse(response =>
              response.url().includes("https://gamecore.rowzone.tech/p/server") &&
              response.status() === 200,
              { timeout: 5000 }
            );
            await page.mouse.click(spinX, spinY);
            const spinResponse = await spinResponsePromise.catch(() => null);
            if (spinResponse) {
              spinSuccess = true;
              console.log(`Agent: ${agent}, GameID: ${gameId} Spin API 回傳 HTTP 200`);
            } else {
              spinAttempts++;
              if (spinAttempts < maxSpinAttempts) {
                console.log(`Spin API 未回傳 200, 第 ${spinAttempts} 次失敗，等待20秒後重新嘗試同一 session...`);
                await page.waitForTimeout(20000);
              } else {
                throw new Error("本次 session 的 Spin API 嘗試均失敗");
              }
            }
          }
        } catch (e) {
          lastError = e;
          sessionAttempt++;
          console.log(`【Playson】Agent: ${agent}, GameID: ${gameId} 已重新取得 URL，第 ${sessionAttempt} 次 session 嘗試後仍未收到 Spin API 回傳 200`);
          if (sessionAttempt >= maxSessionAttempts) {
            errorMessages.push(`Agent: ${agent}, GameID: ${gameId} 測試過程發生錯誤: 已重新取得 URL 並達到最大重試次數，但仍未收到 Spin API 返回200，最後錯誤: ${lastError}`);
          }
        } finally {
          if (typeof context !== 'undefined' && context) {
            try {
              await context.close();
            } catch (closeError) {
              console.log("關閉 context 時發生錯誤:", closeError);
            }
          }
        }
      } // end while session loop
    } // end for gameId
  } // end for agent

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("所有 Agent 測試成功，正常取得 Playson URL 並完成 Spin 點擊");
  }
});

test('Booongo Spin 測試', async ({ browser, request }) => {
  test.setTimeout(0);
  const { expected_Playson, accountPrefix } = ENV_CONFIG; // 如有需要，可修改為 Booongo 對應的 URL 前綴

  // 測試的遊戲 ID 列表：24062 ~ 24070
  const gameIds = [24062, 24063, 24064, 24065, 24066, 24067, 24068, 24069, 24070];

  // 新的 agent 基本清單（後面會產生前綴版本）
  const baseAgents = [
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
    111, 112, 113, 114, 115, 116, 117, 118, 119, 120,
    121, 122, 123, 124, 125, 126, 127, 128, 129, 130,
    131, 132, 133, 134, 135, 136, 137, 139, 140, 141,
    142, 143, 144, 145, 146, 147, 148, 149, 150, 151,
    152, 153, 154, 155, 156, 157, 158, 159, 161, 162,
    165, 167, 168, 169, 170, 171, 172
  ];
  // 先產生 "11" 前綴的 agent 清單（例如 11101 ~ 11172）
  const agents11 = baseAgents.map(a => parseInt("11" + a.toString()));
  // 再產生 "10" 前綴的 agent 清單（例如 10101 ~ 10172）
  const agents10 = baseAgents.map(a => parseInt("10" + a.toString()));
  // 合併清單，順序先測試 agents11，再測試 agents10
  const agents = [...agents11, ...agents10];

  let errorMessages = [];

  // 定義整體 session 重試上限
  const maxSessionAttempts = 3;

  for (const agent of agents) {
    for (const gameId of gameIds) {
      let sessionAttempt = 0;
      let spinSuccess = false;
      let lastError = null;
      while (sessionAttempt < maxSessionAttempts && !spinSuccess) {
        let context;
        try {
          // 重新取得遊戲 URL
          const game_url = await generateGameUrl(request, agent, gameId);
          if (!game_url.startsWith(expected_Playson)) {
            throw new Error(`URL 前綴不符 -> ${game_url}`);
          }

          // 判斷是否需要打錢包（若 agent 在 11101～11172 範圍內則 deposit 10000）
          const ACCOUNT = `${accountPrefix}${agent}${gameId}`;
          console.log(`下注帳號: ${ACCOUNT}`);
          let depositAmount = 0;
          if (agent >= 11101 && agent <= 11172) {
            depositAmount = 10000;
          }
          if (depositAmount > 0 && sessionAttempt === 0) {
            await depositMoney(request, ACCOUNT, agent, depositAmount);
          }

          // 建立新的 browser context 與 page
          context = await browser.newContext({ headless: true });
          const page = await context.newPage();
          await page.goto(game_url, { waitUntil: 'load' });
          await page.waitForLoadState('networkidle');
          const initialError = await page.$('.gr_dialog__message');
          if (initialError) {
            const text = await initialError.textContent();
            throw new Error(`載入遊戲時出現錯誤訊息: ${text}`);
          }
          await page.waitForTimeout(500);

          // 取得 iframe
          const frame = page.frame({ name: 'game' });
          if (!frame) {
            throw new Error("找不到名稱為 'game' 的 iframe");
          }
          let canvas;
          try {
            canvas = await Promise.any([
              frame.waitForSelector('#canvas', { state: 'visible', timeout: 60000 }),
              frame.waitForSelector('#game', { state: 'visible', timeout: 60000 })
            ]);
          } catch (e) {
            throw new Error("找不到遊戲 canvas (id '#canvas' 或 '#game')");
          }
          await frame.waitForTimeout(1000);
          const box = await canvas.boundingBox();
          if (!box) {
            throw new Error("無法取得 canvas bounding box");
          }

          // 進入遊戲重試機制：最多嘗試 3 次
          const enterX = box.x + 636;
          const enterY = box.y + 638;
          let gameEntered = false;
          for (let attempt = 0; attempt < 3 && !gameEntered; attempt++) {
            await page.mouse.click(enterX, enterY);
            await page.waitForTimeout(2000);
            try {
              await Promise.any([
                frame.waitForSelector('#canvas', { state: 'visible', timeout: 5000 }),
                frame.waitForSelector('#game', { state: 'visible', timeout: 5000 })
              ]);
              gameEntered = true;
            } catch (err) {
              console.log(`進入遊戲失敗, 第 ${attempt + 1} 次嘗試，重新點擊進入遊戲`);
              if (attempt === 2) {
                throw new Error("連續嘗試進入遊戲均失敗");
              }
            }
          }

          // Spin 按鈕重試機制：單一 session 中最多嘗試 3 次
          const spinX = box.x + 1180;
          const spinY = box.y + 318;
          let spinAttempts = 0;
          const maxSpinAttempts = 3;
          while (spinAttempts < maxSpinAttempts && !spinSuccess) {
            const spinResponsePromise = page.waitForResponse(response =>
              response.url().includes("https://gamecore.rowzone.tech/b/server") &&
              response.status() === 200,
              { timeout: 5000 }
            );
            await page.mouse.click(spinX, spinY);
            const spinResponse = await spinResponsePromise.catch(() => null);
            if (spinResponse) {
              spinSuccess = true;
              console.log(`Agent: ${agent}, GameID: ${gameId} Spin API 回傳 HTTP 200`);
            } else {
              spinAttempts++;
              if (spinAttempts < maxSpinAttempts) {
                console.log(`Spin API 未回傳 200, 第 ${spinAttempts} 次失敗，等待20秒後重新嘗試同一 session...`);
                await page.waitForTimeout(20000);
              } else {
                throw new Error("本次 session 的 Spin API 嘗試均失敗");
              }
            }
          }
        } catch (e) {
          lastError = e;
          sessionAttempt++;
          console.log(`【Booongo】Agent: ${agent}, GameID: ${gameId} 已重新取得 URL，第 ${sessionAttempt} 次 session 嘗試後仍未收到 Spin API 回傳 200`);
          if (sessionAttempt >= maxSessionAttempts) {
            errorMessages.push(`Agent: ${agent}, GameID: ${gameId} 測試過程發生錯誤: 已重新取得 URL 並達到最大重試次數，但仍未收到 Spin API 返回200，最後錯誤: ${lastError}`);
          }
        } finally {
          if (typeof context !== 'undefined' && context) {
            try {
              await context.close();
            } catch (closeError) {
              console.log("關閉 context 時發生錯誤:", closeError);
            }
          }
        }
      } // end while session loop
    } // end for gameId
  } // end for agent

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("所有 Agent 測試成功，正常取得 Booongo URL 並完成 Spin 點擊");
  }
});