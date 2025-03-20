import { test } from '@playwright/test';
import { ENV_CONFIG, generateGameUrl, depositMoney } from './api-config.js';


// 輔助函式：產生 [start, end) 的數字陣列
function range(start, end) {
  const arr = [];
  for (let i = start; i < end; i++) {
    arr.push(i);
  }
  return arr;
}

// test('URL/遊戲進入', async ({ request }) => {
//   test.setTimeout(0);
//   const { expected_Rectangle } = ENV_CONFIG;

//   // 測試的 game_id 範圍：70001 至 70036（不含70037）
//   const game_ids = range(90001, 90024);

//   // 原始 agent 清單
//   const baseAgents = [
//     101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
//     111, 112, 113, 114, 115, 116, 117, 118, 119, 120,
//     121, 122, 123, 124, 125, 126, 127, 128, 129, 130,
//     131, 132, 133, 134, 135, 136, 137, 139, 140, 141,
//     142, 143, 144, 145, 146, 147, 148, 149, 150, 151,
//     152, 153, 154, 155, 156, 157, 158, 159, 160, 161,
//     162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172
//   ];
//   // 前面都加上 "10"，例如 101 會變成 10101
//   const agents = baseAgents.map(a => parseInt('10' + a));

//   let errorMessages = [];

//   for (const agent of agents) {
//     for (const game_id of game_ids) {
//       try {
//         // 取得遊戲 URL
//         const game_url = await generateGameUrl(request, agent, game_id);
//         if (!game_url.startsWith(expected_Rectangle)) {
//           errorMessages.push(`Agent: ${agent}, GameID: ${game_id} URL 前綴不符 -> ${game_url}`);
//         } else {
//           console.log(`Agent: ${agent}, GameID: ${game_id} 取得的 URL 正確: ${game_url}`);
//         }
//       } catch (e) {
//         errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 測試過程發生錯誤: ${e}`);
//       }
//       // 延遲以避免連續請求過快
//       await new Promise(resolve => setTimeout(resolve, 500));
//     }
//   }

//   if (errorMessages.length > 0) {
//     throw new Error(errorMessages.join("\n"));
//   } else {
//     console.log("所有 agent 測試成功，正常取得遊戲 URL");
//   }
// });





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
        console.log(`Agent: ${agent}, GameID: ${game_id} 取得的 URL: ${game_url}`);

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
          console.log(`Agent: ${agent}, GameID: ${game_id} 金額：${depositAmount}`);
        } else {
          console.log(`Agent: ${agent}, GameID: ${game_id} 不需要打錢包`);
        }

        // 建立新的 browser context 與 page，進入遊戲
        context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(game_url, { waitUntil: 'load' });
        // 等待頁面與 iframe 載入完成 (等待 20000 毫秒)
        await page.waitForTimeout(20000);

        // 檢查 popup 錯誤訊息
        const popup = await page.$('div.popup-container');
        if (popup) {
          const popupText = await popup.innerText();
          if (popupText.includes("Error Code: 3000")) {
            console.log(`Agent: ${agent}, GameID: ${game_id} 檢測到 Error Code: 3000，跳過測試`);
            await context.close();
            continue;
          } else if (popupText.includes("Error Code: 2202")) {
            console.log(`Agent: ${agent}, GameID: ${game_id} 檢測到 Error Code: 2202，嘗試重新取得 URL`);
            // 嘗試重新取得 URL後重新導向
            try {
              const newGameUrl = await generateGameUrl(request, agent, game_id);
              if (!newGameUrl || !newGameUrl.startsWith(expected_Rectangle)) {
                errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 重新取得 URL 前綴不符 -> ${newGameUrl}`);
                await context.close();
                continue;
              }
              console.log(`Agent: ${agent}, GameID: ${game_id} 重新取得 URL: ${newGameUrl}`);
              game_url = newGameUrl;
              await page.goto(game_url, { waitUntil: 'load' });
              await page.waitForTimeout(20000);
              // 再次檢查是否仍有 Error Code: 2202
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
        console.log(`Agent: ${agent}, GameID: ${game_id} Canvas bounding box: ${JSON.stringify(box)}`);

        // 點擊「關閉」按鈕
        const closeRelX = 377.5, closeRelY = 202;
        const closeX = box.x + closeRelX, closeY = box.y + closeRelY;
        console.log(`Agent: ${agent}, GameID: ${game_id} 計算得到的關閉按鈕座標：x=${closeX}, y=${closeY}`);
        await page.mouse.click(closeX, closeY);
        console.log(`Agent: ${agent}, GameID: ${game_id} 已點擊關閉按鈕`);

        // 點擊「Spin」按鈕
        const spinRelX = 200.5, spinRelY = 662;
        const spinX = box.x + spinRelX, spinY = box.y + spinRelY;
        await page.waitForTimeout(1000);
        await page.mouse.click(spinX, spinY);
        console.log(`Agent: ${agent}, GameID: ${game_id} 已點擊 Spin 按鈕`);

        // 等待 spin API 回應
        try {
          const spinApiResponse = await page.waitForResponse(
            response => /https:\/\/api\.sandbox\.revenge-games\.com\/.*\/spin/.test(response.url()),
            { timeout: 10000 }
          );
          const status = spinApiResponse.status();
          if (status !== 201) {
            errorMessages.push(`Agent: ${agent}, GameID: ${game_id} spin API 回應狀態碼為 ${status}`);
          } else {
            console.log(`Agent: ${agent}, GameID: ${game_id} spin API 回應狀態碼驗證成功 (${status})`);
          }
        } catch (error) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 未收到 spin API response，開始重新點擊...`);
          // 若第一次未收到回應則重試點擊關閉與 Spin 按鈕
          await page.mouse.click(closeX, closeY);
          console.log(`Agent: ${agent}, GameID: ${game_id} 重新點擊關閉按鈕`);
          await page.waitForTimeout(1000);
          await page.mouse.click(spinX, spinY);
          console.log(`Agent: ${agent}, GameID: ${game_id} 重新點擊 Spin 按鈕`);
          try {
            const spinApiResponseRetry = await page.waitForResponse(
              response => /https:\/\/api\.sandbox\.revenge-games\.com\/.*\/spin/.test(response.url()),
              { timeout: 10000 }
            );
            const statusRetry = spinApiResponseRetry.status();
            if (statusRetry !== 201) {
              errorMessages.push(`Agent: ${agent}, GameID: ${game_id} retry spin API 回應狀態碼為 ${statusRetry}`);
            } else {
              console.log(`Agent: ${agent}, GameID: ${game_id} retry spin API 回應狀態碼驗證成功 (${statusRetry})`);
            }
          } catch (error2) {
            errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 連續兩次未收到 spin API response，遊戲異常`);
          }
        }

        await context.close();
        // 間隔 2 秒以避免連續請求過快
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 測試過程發生錯誤: ${e}`);
        if (context) await context.close();
      }
    }
  }

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("所有組合測試成功，正常取得遊戲 URL、打錢包並完成 Spin 測試");
  }
});



test.only('Rectangle_下半', async ({ browser, request }) => {
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
        console.log(`Agent: ${agent}, GameID: ${game_id} 取得的 URL: ${game_url}`);

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
          console.log(`Agent: ${agent}, GameID: ${game_id} 金額：${depositAmount}`);
        } else {
          console.log(`Agent: ${agent}, GameID: ${game_id} 不需要打錢包`);
        }

        // 建立新的 browser context 與 page，進入遊戲
        context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(game_url, { waitUntil: 'load' });
        // 等待頁面與 iframe 載入完成 (等待 20000 毫秒)
        await page.waitForTimeout(20000);

        // 檢查 popup 錯誤訊息
        const popup = await page.$('div.popup-container');
        if (popup) {
          const popupText = await popup.innerText();
          if (popupText.includes("Error Code: 3000")) {
            console.log(`Agent: ${agent}, GameID: ${game_id} 檢測到 Error Code: 3000，跳過測試`);
            await context.close();
            continue;
          } else if (popupText.includes("Error Code: 2202")) {
            console.log(`Agent: ${agent}, GameID: ${game_id} 檢測到 Error Code: 2202，嘗試重新取得 URL`);
            try {
              const newGameUrl = await generateGameUrl(request, agent, game_id);
              if (!newGameUrl || !newGameUrl.startsWith(expected_Rectangle)) {
                errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 重新取得 URL 前綴不符 -> ${newGameUrl}`);
                await context.close();
                continue;
              }
              console.log(`Agent: ${agent}, GameID: ${game_id} 重新取得 URL: ${newGameUrl}`);
              game_url = newGameUrl;
              await page.goto(game_url, { waitUntil: 'load' });
              await page.waitForTimeout(20000);
              // 再次檢查錯誤訊息
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
        console.log(`Agent: ${agent}, GameID: ${game_id} Canvas bounding box: ${JSON.stringify(box)}`);

        // 操作 1：點擊「進入」按鈕 (相對於 Canvas：x=637, y=610)
        const enterRelX = 637, enterRelY = 610;
        const enterX = box.x + enterRelX, enterY = box.y + enterRelY;
        console.log(`Agent: ${agent}, GameID: ${game_id} 進入按鈕座標：x=${enterX}, y=${enterY}`);
        await page.mouse.click(enterX, enterY);
        console.log(`Agent: ${agent}, GameID: ${game_id} 已點擊進入按鈕`);
        await page.waitForTimeout(6000);

        // 操作 2：點擊「關閉」按鈕 (相對於 Canvas：x=815, y=216)
        const closeRelX = 815, closeRelY = 216;
        const closeX = box.x + closeRelX, closeY = box.y + closeRelY;
        console.log(`Agent: ${agent}, GameID: ${game_id} 計算得到的關閉按鈕座標：x=${closeX}, y=${closeY}`);
        await page.mouse.click(closeX, closeY);
        console.log(`Agent: ${agent}, GameID: ${game_id} 已點擊關閉按鈕`);
        await page.waitForTimeout(1000);

        // 操作 3：點擊「Spin」按鈕 (相對於 Canvas：x=635, y=649)
        const spinRelX = 635, spinRelY = 649;
        const spinX = box.x + spinRelX, spinY = box.y + spinRelY;
        console.log(`Agent: ${agent}, GameID: ${game_id} 計算得到的 Spin 按鈕座標：x=${spinX}, y=${spinY}`);
        await page.mouse.click(spinX, spinY);
        console.log(`Agent: ${agent}, GameID: ${game_id} 已點擊 Spin 按鈕`);

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
          console.log(`Agent: ${agent}, GameID: ${game_id} 未在第一次等待到 spin API response`);
        }

        // 若第一次未收到回應，重試一次
        if (!received) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 開始重新點擊關閉與 Spin 按鈕`);
          await page.mouse.click(closeX, closeY);
          console.log(`Agent: ${agent}, GameID: ${game_id} 重新點擊關閉按鈕`);
          await page.waitForTimeout(1000);
          await page.mouse.click(spinX, spinY);
          console.log(`Agent: ${agent}, GameID: ${game_id} 重新點擊 Spin 按鈕`);
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
        // 避免連續請求過快，間隔 2 秒
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        errorMessages.push(`Agent: ${agent}, GameID: ${game_id} 測試過程發生錯誤: ${e}`);
        if (context) await context.close();
      }
    }
  }

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("所有組合測試成功，正常取得遊戲 URL、Spin 測試");
  }
});
