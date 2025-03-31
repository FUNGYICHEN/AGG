import { test } from '@playwright/test';

const env = process.env.NODE_ENV || 'stg';
const { ENV_CONFIG, generateGameUrl, depositMoney } = await import(`./${env}環境.js`);


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

  // 依序測試每個 agent 與每款遊戲，若發生錯誤則累積錯誤訊息（不立即中斷）
  for (const agent of agents) {
    for (const gameId of gameIds) {
      let context;
      try {
        // 僅取得一次遊戲 URL，不進行重試
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
        if (depositAmount > 0) {
          await depositMoney(request, ACCOUNT, agent, depositAmount);
        }

        // 建立新的 browser context 與 page
        context = await browser.newContext({ headless: true });
        const page = await context.newPage();
        // 提前註冊 console 監聽器（等待 "connection opened" 訊息）
        const connectionOpenedPromise = new Promise(resolve => {
          page.on('console', msg => {
            if (msg.text().includes("connection opened")) {
              resolve();
            }
          });
        });

        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForLoadState('networkidle');
        // 等待最多 10 秒捕捉 "connection opened" 訊息
        await Promise.race([
          connectionOpenedPromise,
          page.waitForTimeout(10000)
        ]);

        // 取得 iframe（此 iframe 有 name="game"）
        const frame = page.frame({ name: 'game' });
        if (!frame) {
          throw new Error("找不到名稱為 'game' 的 iframe");
        }

        // 取得 iframe 中的 canvas (Playson 的 canvas id 為 "game_canvas")
        const canvas = await frame.waitForSelector('#game_canvas', { state: 'visible', timeout: 10000 });
        if (!canvas) {
          throw new Error("找不到遊戲 canvas");
        }
        const box = await canvas.boundingBox();
        if (!box) {
          throw new Error("無法取得 canvas bounding box");
        }

        // 進入遊戲（這裡也加入進入遊戲的重試機制，最多嘗試 3 次）
        const enterX = box.x + 636;
        const enterY = box.y + 638;
        let gameEntered = false;
        for (let attempt = 0; attempt < 3 && !gameEntered; attempt++) {
          await page.mouse.click(enterX, enterY);
          await page.waitForTimeout(2000);
          try {
            await Promise.race([
              new Promise(resolve => {
                page.on('console', msg => {
                  if (msg.text().includes("connection opened")) {
                    resolve();
                  }
                });
              }),
              page.waitForTimeout(10000)
            ]);
            // 重新檢查 iframe 與 canvas 是否存在
            const frameCheck = page.frame({ name: 'game' });
            if (!frameCheck) throw new Error("找不到名稱為 'game' 的 iframe");
            const canvasCheck = await frameCheck.waitForSelector('#game_canvas', { state: 'visible', timeout: 10000 });
            if (!canvasCheck) throw new Error("找不到遊戲 canvas");
            gameEntered = true;
          } catch (err) {
            console.log(`進入遊戲失敗, 第 ${attempt + 1} 次嘗試，重新點擊進入遊戲`);
            if (attempt === 2) {
              throw new Error("連續嘗試進入遊戲均失敗");
            }
          }
        }

        // Spin API 的重試機制：初次嘗試加上 2 次重試，共 3 次
        const spinX = box.x + 1180;
        const spinY = box.y + 318;
        let spinAttempts = 0;
        let spinSuccess = false;
        const maxSpinAttempts = 3;

        while (spinAttempts < maxSpinAttempts && !spinSuccess) {
          // 設定等待 Spin API 回應的 Promise（5 秒內收到 HTTP 200）
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
              console.log(`Spin API 未回傳 200, 第 ${spinAttempts} 次失敗，等待60秒後重新嘗試...`);
              // 這裡使用 page.waitForTimeout(25000) 暫停 60 秒後，while 迴圈會再次執行，也就是重新點擊並等待回應
              await page.waitForTimeout(60000);
            } else {
              // 若超過最大嘗試次數，累積錯誤訊息
              const errorElement = await page.$('.gr_dialog__message');
              if (errorElement) {
                const errorText = await errorElement.textContent();
                throw new Error(`Spin 時發現錯誤訊息: ${errorText}`);
              } else {
                throw new Error("Spin API 未回傳 200 after all attempts");
              }
            }
          }
        }

        await context.close();
      } catch (e) {
        if (context) await context.close();
        errorMessages.push(`Agent: ${agent}, GameID: ${gameId} 測試過程發生錯誤: ${e}`);
      }
    }
  }

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("所有 Agent 測試成功，正常取得 Playson URL 並完成 Spin 點擊");
  }
});






test.only('Booongo Spin 測試', async ({ browser, request }) => {
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

  // 依序測試每個 agent 與每款遊戲，確保每款測試完成後關閉瀏覽器 context
  for (const agent of agents) {
    for (const gameId of gameIds) {
      let context;
      try {
        // 取得遊戲 URL（僅取得一次，不重試）
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
        if (depositAmount > 0) {
          await depositMoney(request, ACCOUNT, agent, depositAmount);
        }

        // 建立新的 browser context 與 page，進入遊戲頁面
        context = await browser.newContext({ headless: true });
        const page = await context.newPage();
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForLoadState('networkidle');
        // 載入完成後，先檢查是否出現錯誤訊息（例如「程序错误」或「请联系客服」）
        const initialError = await page.$('.gr_dialog__message');
        if (initialError) {
          const text = await initialError.textContent();
          throw new Error(`載入遊戲時出現錯誤訊息: ${text}`);
        }
        await page.waitForTimeout(500);

        // 使用 iframe 的 name 直接取得 frame（此 iframe 有 name="game"）
        const frame = page.frame({ name: 'game' });
        if (!frame) {
          throw new Error("找不到名稱為 'game' 的 iframe");
        }

        // 同時等待 id 為 "#canvas" 與 "#game"，取最快出現者
        let canvas;
        try {
          canvas = await Promise.any([
            frame.waitForSelector('#canvas', { state: 'visible', timeout: 60000 }),
            frame.waitForSelector('#game', { state: 'visible', timeout: 60000 })
          ]);
        } catch (e) {
          throw new Error("找不到遊戲 canvas (id '#canvas' 或 '#game')");
        }
        // 等待一段延遲以確保 canvas 完全渲染
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
            // 檢查是否成功進入遊戲：等待 canvas 或 #game 重新出現
            await Promise.any([
              frame.waitForSelector('#canvas', { state: 'visible', timeout: 60000 }),
              frame.waitForSelector('#game', { state: 'visible', timeout: 60000 })
            ]);
            gameEntered = true;
          } catch (err) {
            console.log(`進入遊戲失敗, 第 ${attempt + 1} 次嘗試，重新點擊進入遊戲`);
            if (attempt === 2) {
              throw new Error("連續嘗試進入遊戲均失敗");
            }
          }
        }

        // Spin 按鈕重試機制：最多嘗試 3 次（初次嘗試 + 2 次重試）
        const spinX = box.x + 1180;
        const spinY = box.y + 318;
        let spinAttempts = 0;
        let spinSuccess = false;
        const maxSpinAttempts = 3;
        while (spinAttempts < maxSpinAttempts && !spinSuccess) {
          // 設定等待 Spin API 回應的 Promise（5 秒內收到 HTTP 200）
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
              console.log(`Spin API 未回傳 200, 第 ${spinAttempts} 次失敗，等待25秒後重新嘗試...`);
              // 等待25秒後重新嘗試：使用 page.waitForTimeout(25000) 暫停 25000 毫秒，然後 while 迴圈會再次執行
              await page.waitForTimeout(25000);
            } else {
              // 若超過最大嘗試次數，嘗試捕捉錯誤訊息並拋出錯誤
              const errorElement = await page.$('.gr_dialog__message');
              if (errorElement) {
                const errorText = await errorElement.textContent();
                throw new Error(`Spin 時發現錯誤訊息: ${errorText}`);
              } else {
                throw new Error("Spin API 未回傳 200");
              }
            }
          }
        }

        // 測試成功，關閉 context
        await context.close();
      } catch (e) {
        if (context) {
          await context.close();
        }
        errorMessages.push(`Agent: ${agent}, GameID: ${gameId} 測試過程發生錯誤: ${e}`);
      }
    }
  }

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("所有 Agent 測試成功，正常取得 Booongo URL 並完成 Spin 點擊");
  }
});
