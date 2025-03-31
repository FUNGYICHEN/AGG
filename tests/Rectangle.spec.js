import { test } from '@playwright/test';

const env = process.env.NODE_ENV || 'stg';
const { ENV_CONFIG, generateGameUrl, depositMoney } = await import(`./${env}環境.js`);

// 輔助函式：產生 [start, end) 的數字陣列
function range(start, end) {
  const arr = [];
  for (let i = start; i < end; i++) {
    arr.push(i);
  }
  return arr;
}
test.describe.configure({ mode: 'serial' });
test('Rectangle_上半', async ({ browser, request }) => {
  test.setTimeout(0);
  const { expected_Rectangle, accountPrefix } = ENV_CONFIG;

  // 建立遊戲 ID 清單：90001 ~ 90024，排除 90012, 90013, 90014, 90015, 90016
  const gameIds = Array.from({ length: 24 }, (_, i) => 90001 + i)
    .filter(id => ![90012, 90013, 90014, 90015, 90016].includes(id));

  // 建立 agent 清單
  const agents_111 = Array.from({ length: 11172 - 11101 + 1 }, (_, i) => 11101 + i)
    .filter(agent => agent !== 11138);
  const agents_101 = Array.from({ length: 10172 - 10111 + 1 }, (_, i) => 10111 + i);

  // 合併兩個清單
  const agents = [...agents_111, ...agents_101];

  let errorMessages = [];

  // 依序測試每個 agent 與 gameId 組合
  for (const agent of agents) {
    for (const game_id of gameIds) {
      let context;
      try {
        // 取得遊戲 URL
        let game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_Rectangle)) {
          errorMessages.push(`Agent: ${agent}, GameID: ${game_id} URL 前綴不符 -> ${game_url}`);
          continue;
        }

        // 產生下注帳號，使用 ENV_CONFIG.accountPrefix
        const ACCOUNT = `${accountPrefix}${agent}${game_id}`;
        console.log(`Agent: ${agent}, GameID: ${game_id} 使用下注帳號: ${ACCOUNT}`);

        // 根據 agent 決定 deposit 金額：
        // 若 agent 在 11101 ~ 11172，則 deposit 10000；若 agent 號碼以 10 開頭（10111 ~ 10172），則不需打錢包
        let depositAmount = 0;
        if (agent >= 11101 && agent <= 11172) {
          depositAmount = 10000;
        }
        if (depositAmount > 0) {
          await depositMoney(request, ACCOUNT, agent, depositAmount);
        }

        // 建立新的 browser context 與 page，進入遊戲
        context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(40000);

        // 檢查 popup 錯誤訊息
        const popup = await page.$('div.popup-container');
        if (popup) {
          const popupText = await popup.innerText();
          if (popupText.includes("Error Code: 3000")) {
            await context.close();
            continue;
          } else if (popupText.includes("Error Code: 2202")) {
            try {
              const newGameUrl = await generateGameUrl(request, agent, game_id);
              if (!newGameUrl || !newGameUrl.startsWith(expected_Rectangle)) {
                // 可加入額外處理
              }
              game_url = newGameUrl;
              await page.goto(game_url, { waitUntil: 'load' });
              await page.waitForTimeout(20000);
              const retryPopup = await page.$('div.popup-container');
              if (retryPopup) {
                const retryText = await retryPopup.innerText();
                if (retryText.includes("Error Code: 2202")) {
                  errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 重新取得 URL 後仍出現 Error Code: 2202`);
                  await context.close();
                  continue;
                }
              }
            } catch (err) {
              errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 重新取得 URL 發生錯誤: ${err}`);
              await context.close();
              continue;
            }
          }
        }

        // 取得 Canvas 元素及其 bounding box
        const canvas = await page.$('#GameCanvas');
        if (!canvas) {
          errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 找不到遊戲 canvas`);
          await context.close();
          continue;
        }
        const box = await canvas.boundingBox();
        if (!box) {
          errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 無法取得 canvas bounding box`);
          await context.close();
          continue;
        }

        // 點擊「關閉」按鈕
        const closeRelX = 377.5, closeRelY = 202;
        const closeX = box.x + closeRelX, closeY = box.y + closeRelY;
        await page.mouse.click(closeX, closeY);

        // 點擊「Spin」按鈕
        const spinRelX = 200.5, spinRelY = 662;
        const spinX = box.x + spinRelX, spinY = box.y + spinRelY;
        await page.waitForTimeout(1000);
        await page.mouse.click(spinX, spinY);

        // 等待 spin API 回應
        let received = false;
        try {
          const spinApiResponse = await page.waitForResponse(
            response => /https:\/\/api\.sandbox\.revenge-games\.com\/.*\/spin/.test(response.url()),
            { timeout: 10000 }
          );
          const status = spinApiResponse.status();
          if (status === 201) {
            console.log(`Agent: ${agent}, GameID: ${game_id} spin API 回應狀態碼驗證成功 (${status})`);
            received = true;
          } else {
            const responseText = await spinApiResponse.text();
            errorMessages.push(`Agent: ${agent}, GameID: ${game_id} spin API 回應狀態碼為 ${status}. API 回傳: ${responseText}`);
          }
        } catch (err) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 未在第一次等待到 spin API response`);
        }

        if (!received) {
          await page.waitForTimeout(5000);
          await page.mouse.click(closeX, closeY);
          await page.waitForTimeout(1000);
          await page.mouse.click(spinX, spinY);
          try {
            const spinApiResponseRetry = await page.waitForResponse(
              response => /https:\/\/api\.sandbox\.revenge-games\.com\/.*\/spin/.test(response.url()),
              { timeout: 10000 }
            );
            const statusRetry = spinApiResponseRetry.status();
            if (statusRetry === 201) {
              console.log(`Agent: ${agent}, GameID: ${game_id} retry spin API 回應狀態碼驗證成功 (${statusRetry})`);
              received = true;
            } else {
              const responseTextRetry = await spinApiResponseRetry.text();
              errorMessages.push(`Agent: ${agent}, GameID: ${game_id} retry spin API 回應狀態碼為 ${statusRetry}. API 回傳: ${responseTextRetry}`);
            }
          } catch (err2) {
            errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 連續兩次未收到 spin API response，遊戲異常`);
          }
        }

        await context.close();
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 測試過程發生錯誤: ${e}`);
        if (context) await context.close();
      }
    }
  }

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  }
});



test('Rectangle_下半', async ({ browser, request }) => {
  test.setTimeout(0);
  const { expected_Rectangle, accountPrefix } = ENV_CONFIG;

  // 僅測試 gameId：90012, 90013, 90014, 90015, 90016
  const gameIds = [90012, 90013, 90014, 90015, 90016];

  // 建立 agent 清單
  const agents_111 = Array.from({ length: 11172 - 11101 + 1 }, (_, i) => 11101 + i)
    .filter(agent => agent !== 11138);
  const agents_101 = Array.from({ length: 10172 - 10111 + 1 }, (_, i) => 10111 + i);

  // 合併兩個清單
  const agents = [...agents_111, ...agents_101];

  let errorMessages = [];

  // 依序測試每個 agent 與 gameId 組合
  for (const agent of agents) {
    for (const game_id of gameIds) {
      let context;
      try {
        // 取得遊戲 URL
        let game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_Rectangle)) {
          errorMessages.push(`Agent: ${agent}, GameID: ${game_id} URL 前綴不符 -> ${game_url}`);
          continue;
        }

        // 產生下注帳號，使用 ENV_CONFIG.accountPrefix (僅保留此 log)
        const ACCOUNT = `${accountPrefix}${agent}${game_id}`;
        console.log(`Agent: ${agent}, GameID: ${game_id} 使用下注帳號: ${ACCOUNT}`);

        // 根據 agent 決定 deposit 金額：
        // 若 agent 在 11101 ~ 11172，則 deposit 10000；若 agent 號碼以 10 開頭（10111 ~ 10172），則不需打錢包
        let depositAmount = 0;
        if (agent >= 11101 && agent <= 11172) {
          depositAmount = 10000;
        }
        if (depositAmount > 0) {
          await depositMoney(request, ACCOUNT, agent, depositAmount);
        }

        // 建立新的 browser context 與 page，進入遊戲
        context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(40000);

        // 檢查 popup 錯誤訊息
        const popup = await page.$('div.popup-container');
        if (popup) {
          const popupText = await popup.innerText();
          if (popupText.includes("Error Code: 3000")) {
            await context.close();
            continue;
          } else if (popupText.includes("Error Code: 2202")) {
            try {
              const newGameUrl = await generateGameUrl(request, agent, game_id);
              if (!newGameUrl || !newGameUrl.startsWith(expected_Rectangle)) {
                errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 重新取得 URL 前綴不符 -> ${newGameUrl}`);
                await context.close();
                continue;
              }
              game_url = newGameUrl;
              await page.goto(game_url, { waitUntil: 'load' });
              await page.waitForTimeout(20000);
              const retryPopup = await page.$('div.popup-container');
              if (retryPopup) {
                const retryText = await retryPopup.innerText();
                if (retryText.includes("Error Code: 2202")) {
                  errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 重新取得 URL 後仍出現 Error Code: 2202`);
                  await context.close();
                  continue;
                }
              }
            } catch (err) {
              errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 重新取得 URL 發生錯誤: ${err}`);
              await context.close();
              continue;
            }
          }
        }

        // 取得 Canvas 元素及其 bounding box
        const canvas = await page.$('#GameCanvas');
        if (!canvas) {
          errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 找不到遊戲 canvas`);
          await context.close();
          continue;
        }
        const box = await canvas.boundingBox();
        if (!box) {
          errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 無法取得 canvas bounding box`);
          await context.close();
          continue;
        }

        // 操作 1：點擊「進入」按鈕
        const enterRelX = 637, enterRelY = 610;
        const enterX = box.x + enterRelX, enterY = box.y + enterRelY;
        await page.mouse.click(enterX, enterY);
        await page.waitForTimeout(6000);

        // 操作 2：點擊「關閉」按鈕
        const closeRelX = 815, closeRelY = 216;
        const closeX = box.x + closeRelX, closeY = box.y + closeRelY;
        await page.mouse.click(closeX, closeY);
        await page.waitForTimeout(1000);

        // 操作 3：點擊「Spin」按鈕
        const spinRelX = 635, spinRelY = 649;
        const spinX = box.x + spinRelX, spinY = box.y + spinRelY;
        await page.mouse.click(spinX, spinY);

        // 等待 spin API 回應
        let received = false;
        try {
          const spinApiResponse = await page.waitForResponse(
            response => /https:\/\/api\.sandbox\.revenge-games\.com\/.*\/spin/.test(response.url()),
            { timeout: 10000 }
          );
          const status = spinApiResponse.status();
          if (status === 201) {
            console.log(`Agent: ${agent}, GameID: ${game_id} spin API 回應狀態碼驗證成功 (${status})`);
            received = true;
          } else {
            errorMessages.push(`Agent: ${agent}, GameID: ${game_id} spin API 回應狀態碼為 ${status}`);
          }
        } catch (err) {
          // 不做處理
        }

        // 若第一次未收到回應，重試一次
        if (!received) {
          await page.waitForTimeout(80000);
          await page.mouse.click(closeX, closeY);
          await page.waitForTimeout(2000);
          await page.mouse.click(spinX, spinY);
          try {
            const spinApiResponseRetry = await page.waitForResponse(
              response => /https:\/\/api\.sandbox\.revenge-games\.com\/.*\/spin/.test(response.url()),
              { timeout: 10000 }
            );
            const statusRetry = spinApiResponseRetry.status();
            if (statusRetry === 201) {
              console.log(`Agent: ${agent}, GameID: ${game_id} retry spin API 回應狀態碼驗證成功 (${statusRetry})`);
              received = true;
            } else {
              errorMessages.push(`Agent: ${agent}, GameID: ${game_id} retry spin API 回應狀態碼為 ${statusRetry}`);
            }
          } catch (err2) {
            errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 連續兩次未收到 spin API response，遊戲異常`);
          }
        }

        await context.close();
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 測試過程發生錯誤: ${e}`);
        if (context) await context.close();
      }
    }
  }

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  }
});
