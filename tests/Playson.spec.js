import { test, expect } from '@playwright/test';
import {ENV_CONFIG, generateGameUrl, depositMoney } from './STG環境.js';


    
    test('Playson Spin 測試', async ({ browser, request }) => {
        test.setTimeout(0);
        const { expected_Playson, accountPrefix } = ENV_CONFIG;; // 例如 "https://static-stage.rowzone.tech/"
      
        // 測試的遊戲 ID 列表：20051 ~ 20059
        const gameIds = [20051, 20052, 20053, 20054, 20055, 20056, 20057, 20058, 20059];
      
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
        // 先建立 "11" 前綴的 agent 清單，再建立 "10" 前綴的 agent 清單
        const agents11 = baseAgents.map(a => parseInt("11" + a.toString()));
        const agents10 = baseAgents.map(a => parseInt("10" + a.toString()));
        const agents = [...agents11, ...agents10];
      
        let errorMessages = [];
      
        // 對每個 agent 與每款遊戲依序測試（每款遊戲測試完成後關閉瀏覽器 context）
        for (const agent of agents) {
          for (const gameId of gameIds) {
            let attempt = 0;
            const maxAttempts = 2;
            let passed = false;
            while (!passed && attempt < maxAttempts) {
              let context;
              try {
                // 取得遊戲 URL
                const game_url = await generateGameUrl(request, agent, gameId);
                console.log(`Agent: ${agent}, GameID: ${gameId} 取得的 URL: ${game_url}`);
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
                  console.log(`Agent: ${agent}, GameID: ${gameId} 增加錢包餘額：${depositAmount}`);
                } else {
                  console.log(`Agent: ${agent}, GameID: ${gameId} 不需要打錢包`);
                }
      
                // 建立新的 browser context 與 page
                context = await browser.newContext({ headless: true });
                const page = await context.newPage();
                await page.goto(game_url, { waitUntil: 'load' });
                await page.waitForLoadState('networkidle');
                // 等待固定時間，確保頁面載入完成
                await page.waitForTimeout(50000);
      
                // 使用 iframe 的 name 直接取得 frame（此 iframe 有 name="game"）
                const frame = page.frame({ name: 'game' });
                if (!frame) {
                  throw new Error("找不到名稱為 'game' 的 iframe");
                }
      
                // 取得 iframe 中的 canvas (Playson 的 canvas id 為 "game_canvas")
                const canvas = await frame.waitForSelector('#game_canvas', { state: 'visible', timeout: 60000 });
                if (!canvas) {
                  throw new Error("找不到遊戲 canvas");
                }
                const box = await canvas.boundingBox();
                if (!box) {
                  throw new Error("無法取得 canvas bounding box");
                }
                console.log(`Agent: ${agent}, GameID: ${gameId} Canvas bounding box: ${JSON.stringify(box)}`);
      
                // 點擊進入遊戲 (相對於 canvas 的位置：x = box.x + 636, y = box.y + 638)
                const enterX = box.x + 636;
                const enterY = box.y + 638;
                await page.mouse.click(enterX, enterY);
                console.log(`Agent: ${agent}, GameID: ${gameId} 點擊進入遊戲 (x=${enterX}, y=${enterY})`);
                // 等待兩秒
                await page.waitForTimeout(2000);
      
                // 先設定等待 Spin API 回應的 Promise（5秒內收到 HTTP 200）
                const spinResponsePromise = page.waitForResponse(response =>
                  response.url().includes("https://gamecore.rowzone.tech/p/server") &&
                  response.status() === 200,
                  { timeout: 5000 }
                );
      
                // 點擊 Spin 按鈕 (相對於 canvas 的位置：x = box.x + 1180, y = box.y + 318)
                const spinX = box.x + 1180;
                const spinY = box.y + 318;
                await page.mouse.click(spinX, spinY);
                console.log(`Agent: ${agent}, GameID: ${gameId} 點擊 Spin 按鈕 (x=${spinX}, y=${spinY})`);
      
                // 等待 Spin API 回應
                const spinResponse = await spinResponsePromise.catch(() => null);
                if (!spinResponse) {
                  // 若未收到 API 回應，檢查是否有錯誤訊息出現（不再額外等待）
                  const errorElement = await page.$('.gr_dialog__message');
                  if (errorElement) {
                    const errorText = await errorElement.textContent();
                    throw new Error(`Spin 時發現錯誤訊息: ${errorText}`);
                  } else {
                    throw new Error("Spin API 未回傳 200");
                  }
                }
                console.log(`Agent: ${agent}, GameID: ${gameId} Spin API 回傳 HTTP 200`);
      
                // 測試成功，關閉 context 後離開重試迴圈
                await context.close();
                passed = true;
              } catch (e) {
                attempt++;
                console.log(`Agent: ${agent}, GameID: ${gameId} 嘗試 ${attempt} 次失敗，錯誤: ${e}`);
                if (context) {
                  await context.close();
                }
                if (attempt >= maxAttempts) {
                  errorMessages.push(`Agent: ${agent}, GameID: ${gameId} 測試過程發生錯誤: ${e}`);
                } else {
                  console.log(`重新取得遊戲 URL 並重試...`);
                }
              }
            } // end while
          }
        }
      
        if (errorMessages.length > 0) {
          throw new Error(errorMessages.join("\n"));
        } else {
          console.log("所有 Agent 測試成功，正常取得 Playson URL 並完成 Spin 點擊");
        }
      });
    


      test('Booongo Spin 測試', async ({ browser, request }) => {
        test.setTimeout(0);
        const { expected_Playson, accountPrefix } = ENV_CONFIG;// 如有需要，可修改為 Booongo 對應的 URL 前綴
      
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
      
        // 依序對每個 agent 與每款遊戲測試，確保每款遊戲測試完成後關閉瀏覽器 context
        for (const agent of agents) {
          for (const gameId of gameIds) {
            let attempt = 0;
            const maxAttempts = 2;
            let passed = false;
            while (!passed && attempt < maxAttempts) {
              let context;
              try {
                // 取得遊戲 URL
                const game_url = await generateGameUrl(request, agent, gameId);
                console.log(`Agent: ${agent}, GameID: ${gameId} 取得的 URL: ${game_url}`);
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
                  console.log(`Agent: ${agent}, GameID: ${gameId} 增加錢包餘額：${depositAmount}`);
                } else {
                  console.log(`Agent: ${agent}, GameID: ${gameId} 不需要打錢包`);
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
                console.log(`Agent: ${agent}, GameID: ${gameId} Canvas bounding box: ${JSON.stringify(box)}`);
      
                // 點擊進入遊戲 (相對於 canvas 的位置：x = box.x + 636, y = box.y + 638)
                const enterX = box.x + 636;
                const enterY = box.y + 638;
                await page.mouse.click(enterX, enterY);
                console.log(`Agent: ${agent}, GameID: ${gameId} 點擊進入遊戲 (x=${enterX}, y=${enterY})`);
                // 等待兩秒
                await page.waitForTimeout(2000);
      
                // 點擊 Spin 按鈕 (相對於 canvas 的位置：x = box.x + 1180, y = box.y + 318)
                const spinX = box.x + 1180;
                const spinY = box.y + 318;
                await page.mouse.click(spinX, spinY);
                console.log(`Agent: ${agent}, GameID: ${gameId} 點擊 Spin 按鈕 (x=${spinX}, y=${spinY})`);
      
                // 等待 Spin API 回應（5秒內收到 HTTP 200）
                const spinResponse = await page.waitForResponse(response =>
                  response.url().includes("https://gamecore.rowzone.tech/b/server") &&
                  response.status() === 200,
                  { timeout: 5000 }
                ).catch(() => null);
      
                if (!spinResponse) {
                  // 若未收到 API 回應，檢查是否有錯誤訊息出現（不再額外等待）
                  const errorElement = await page.$('.gr_dialog__message');
                  if (errorElement) {
                    const errorText = await errorElement.textContent();
                    throw new Error(`Spin 時發現錯誤訊息: ${errorText}`);
                  } else {
                    throw new Error("Spin API 未回傳 200");
                  }
                }
                console.log(`Agent: ${agent}, GameID: ${gameId} Spin API 回傳 HTTP 200`);
      
                // 測試成功，關閉 context 後跳出重試迴圈
                await context.close();
                passed = true;
              } catch (e) {
                attempt++;
                console.log(`Agent: ${agent}, GameID: ${gameId} 嘗試 ${attempt} 次失敗，錯誤: ${e}`);
                if (context) {
                  await context.close();
                }
                if (attempt >= maxAttempts) {
                  errorMessages.push(`Agent: ${agent}, GameID: ${gameId} 測試過程發生錯誤: ${e}`);
                } else {
                  console.log(`重新取得遊戲 URL 並重試...`);
                }
              }
            } // end while
          }
        }
      
        if (errorMessages.length > 0) {
          throw new Error(errorMessages.join("\n"));
        } else {
          console.log("所有 Agent 測試成功，正常取得 Booongo URL 並完成 Spin 點擊");
        }
      });