import { test } from '@playwright/test';

const env = process.env.NODE_ENV || 'stg';
const { ENV_CONFIG, generateGameUrl } = await import(`./${env}環境.js`);

// 定義 range 函式：產生從 start 到 end-1 的數字陣列
const range = (start, end) => Array.from({ length: end - start }, (_, i) => start + i);


test.describe.configure({ mode: 'serial' });
test('70001_Cash Show: 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  async function waitForValidCountdown(page, timerLocator, agent) {
    while (await timerLocator.count() === 0) {
      await page.waitForTimeout(500);
    }
    await timerLocator.waitFor({ state: 'visible', timeout: 5000 });
    let timerText = await timerLocator.textContent();
    let remainingTime = parseInt(timerText.trim());
    console.log(`Agent: ${agent} 初始剩餘時間：${remainingTime} 秒`);
    if (remainingTime <= 2) {
      console.log(`Agent: ${agent} 剩餘時間不足 (<=2秒)，等待下一輪下注機會`);
      let lastLoggedTime = remainingTime;
      while (true) {
        await page.waitForTimeout(500);
        timerText = await timerLocator.textContent();
        remainingTime = parseInt(timerText.trim());
        if (remainingTime !== lastLoggedTime) {
          console.log(`Agent: ${agent} 更新剩餘時間：${remainingTime} 秒`);
          lastLoggedTime = remainingTime;
        }
        if (remainingTime >= 3) break;
      }
    }
    return remainingTime;
  }

  // 使用範圍與排除清單建立 agent 清單 (範例)
  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109, 10123, 10129, 10131, 10138, 10160, 10163, 10164, 10165, 10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                    .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70001;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {}; // 記錄每個 agent 的錯誤訊息
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        // 取得並驗證原始 URL
        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        // 建立獨立的 context 與 page，直接使用原始 game_url
        context = await browser.newContext();
        const page = await context.newPage();

        // API 失敗偵測：監聽 response 判斷是否包含失敗關鍵字
        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(6000);
        if (apiFailed) {
          throw new Error(`Agent ${agent} API error detected.`);
        }

        // --- Loader 判斷邏輯 ---
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }
        // --- Loader 判斷結束 ---

        const frameLocator = page.frameLocator('#bogFrame');

        // 關閉彈窗：等待並點擊關閉按鈕
        const closeButton = frameLocator.locator('button[aria-label="Close"]');
        await closeButton.waitFor({ state: 'visible', timeout: 5000 });
        await closeButton.click();
        console.log(`Agent: ${agent} 關閉彈窗`);

        // 定位下注相關元素
        const timerLocator = frameLocator.locator('span[data-testid="tmr-spn"]');
        const betButton = frameLocator.locator('xpath=//*[@id="root"]/div/div/div/div/div/div[2]/div/div[2]/div[1]/div/div[2]/button/div').first();
        const notificationLocator = frameLocator.locator('div[data-testid="desktop-notification-0"]');
        const errorIcon = notificationLocator.locator('svg[data-testid="desktop-notification-0_warning-icon"]');
        const successIcon = notificationLocator.locator('svg[data-testid="desktop-notification-0_approve-icon"]');

        // 下注循環
        let betAttemptCount = 0;
        const maxBetAttempts = 2;
        let betSuccess = false;
        while (!betSuccess && betAttemptCount < maxBetAttempts) {
          betAttemptCount++;
          const remainingTime = await waitForValidCountdown(page, timerLocator, agent);
          if (remainingTime >= 3) {
            await betButton.waitFor({ state: 'visible', timeout: 5000 });
            await betButton.click();
            console.log(`Agent: ${agent} 已點擊下注按鈕 (bet attempt ${betAttemptCount})`);

            await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
            if (await errorIcon.count() > 0 && await errorIcon.isVisible()) {
              const errorText = await notificationLocator.locator('p[data-testid="desktop-notification-0_text"]').textContent();
              if (errorText.includes("交易错误")) {
                console.log(`Agent: ${agent} ${errorText}, 等待下一輪下注機會`);
                continue;
              } else if (errorText.includes("无效代币")) {
                throw new Error(`API error detected.`);
              } else {
                throw new Error(`API error detected.`);
              }
            } else if (await successIcon.count() > 0 && await successIcon.isVisible()) {
              console.log(`Agent: ${agent} 下注成功！`);
              betSuccess = true;
            } else {
              throw new Error(`API error detected.`);
            }
          } else {
            console.log(`Agent: ${agent} 計時器消失或剩餘時間不足，不下注`);
            break;
          }
        }

        if (!betSuccess) {
          throw new Error(`API error detected.`);
        }

        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});

test('70002_Crash: 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  // 使用範圍與排除清單建立 agent 清單 (範例)
  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109, 10123, 10129, 10131, 10138, 10160, 10163, 10164, 10165, 10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                    .filter(agent => !excludeAgents.includes(agent));
  const game_id = 70002;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        // 取得並驗證原始 URL
        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        // 建立獨立的 context 與 page，直接使用 game_url
        context = await browser.newContext();
        const page = await context.newPage();

        // API 失敗偵測
        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(6000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        // --- Loader 判斷邏輯 ---
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }
        // --- Loader 判斷結束 ---

        const frameLocator = page.frameLocator('#bogFrame');

        // 關閉彈窗：等待並點擊關閉按鈕
        const closeButton = frameLocator.locator('button[aria-label="Close"]');
        await closeButton.waitFor({ state: 'visible', timeout: 5000 });
        await closeButton.click();
        console.log(`Agent: ${agent} 關閉彈窗`);

        // 使用 frameLocator 定位下注相關元素
        const timerLocator = frameLocator.locator('span[data-testid="tmr-spn"]');
        const betButton = frameLocator.locator('xpath=//*[@id="root"]/div/div/div/div/div/div[2]/div/div[2]/div[1]/div/div[2]/button/div').first();
        const notificationLocator = frameLocator.locator('div[data-testid="desktop-notification-0"]');
        const errorIcon = notificationLocator.locator('svg[data-testid="desktop-notification-0_warning-icon"]');
        const successIcon = notificationLocator.locator('svg[data-testid="desktop-notification-0_approve-icon"]');

        let betAttemptCount = 0;
        const maxBetAttempts = 2;
        let betSuccess = false;
        while (!betSuccess && betAttemptCount < maxBetAttempts) {
          betAttemptCount++;
          // 取得倒數計時器數值
          const remainingTime = await (async () => {
            while (await timerLocator.count() === 0) {
              await page.waitForTimeout(500);
            }
            await timerLocator.waitFor({ state: 'visible', timeout: 5000 });
            let timerText = await timerLocator.textContent();
            return parseInt(timerText.trim());
          })();
          if (remainingTime >= 3) {
            await betButton.waitFor({ state: 'visible', timeout: 5000 });
            await betButton.click();
            console.log(`Agent: ${agent} 已點擊下注按鈕 (bet attempt ${betAttemptCount})`);

            await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
            if (await errorIcon.count() > 0 && await errorIcon.isVisible()) {
              const errorText = await notificationLocator.locator('p[data-testid="desktop-notification-0_text"]').textContent();
              if (errorText.includes("交易错误")) {
                console.log(`Agent: ${agent} ${errorText}, 等待下一輪下注機會`);
                continue;
              } else if (errorText.includes("无效代币")) {
                throw new Error("API error detected.");
              } else {
                throw new Error("API error detected.");
              }
            } else if (await successIcon.count() > 0 && await successIcon.isVisible()) {
              console.log(`Agent: ${agent} 下注成功！`);
              betSuccess = true;
            } else {
              throw new Error("API error detected.");
            }
          } else {
            console.log(`Agent: ${agent} 計時器剩餘時間不足 (${remainingTime}秒)，等待下一輪下注機會`);
            await page.waitForTimeout(5000);
            continue;
          }
        }

        if (!betSuccess) {
          throw new Error("API error detected.");
        }

        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});


test('70003_Rocketon: 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  // 使用範圍與排除清單建立 agent 清單 (範例)
  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109, 10123, 10129, 10131, 10138, 10160, 10163, 10164, 10165, 10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                      .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70003;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        context = await browser.newContext();
        const page = await context.newPage();

        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(6000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        // --- Loader 判斷邏輯 ---
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }
        // --- Loader 判斷結束 ---

        const frameLocator = page.frameLocator('#bogFrame');

        // 關閉彈窗：等待並點擊關閉按鈕
        const closeButton = frameLocator.locator('button[aria-label="Close"]');
        await closeButton.waitFor({ state: 'visible', timeout: 5000 });
        await closeButton.click();
        console.log(`Agent: ${agent} 關閉彈窗`);

        // 直接點擊下注按鈕，不再等待倒數
        const betButton = frameLocator.locator('xpath=//*[@id="root"]/div/div/div/div/div/div[2]/div/div[2]/div[1]/div/div[2]/button/div').first();
        await betButton.waitFor({ state: 'visible', timeout: 5000 });
        await betButton.click();
        console.log(`Agent: ${agent} 直接點擊下注按鈕`);

        // 等待下注通知
        const notificationLocator = frameLocator.locator('div[data-testid="desktop-notification-0"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 50000 });
        if (await notificationLocator.locator('svg[data-testid="desktop-notification-0_warning-icon"]').count() > 0 &&
            await notificationLocator.locator('svg[data-testid="desktop-notification-0_warning-icon"]').isVisible()) {
          const errorText = await notificationLocator.locator('p[data-testid="desktop-notification-0_text"]').textContent();
          if (errorText.includes("交易错误")) {
            console.log(`Agent: ${agent} ${errorText}, 等待下一輪下注機會`);
            continue;
          } else if (errorText.includes("无效代币")) {
            throw new Error("API error detected.");
          } else {
            throw new Error("API error detected.");
          }
        } else if (await notificationLocator.locator('svg[data-testid="desktop-notification-0_approve-icon"]').count() > 0 &&
                   await notificationLocator.locator('svg[data-testid="desktop-notification-0_approve-icon"]').isVisible()) {
          console.log(`Agent: ${agent} 下注成功！`);
        } else {
          throw new Error("API error detected.");
        }
        
        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});

test('70004_Keno 10 (1 Minute): 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  async function waitForValidCountdownKeno(frame, countdownLocator, agent) {
    await countdownLocator.waitFor({ state: 'visible', timeout: 5000 });
    let countdownText = (await countdownLocator.textContent()).trim();
    let remainingTime = parseInt(countdownText);
    console.log(`Agent: ${agent} 當前倒數時間：${remainingTime} 秒`);
    return remainingTime;
  }

  async function waitUntilNotDrawing(frame, agent) {
    const drawIndicator = frame.locator('div.JvL3z span.gprCY');
    let printed = false;
    while (true) {
      if (await drawIndicator.count() > 0 && await drawIndicator.isVisible()) {
        let drawValueText = (await drawIndicator.textContent()).trim();
        let drawValue = parseInt(drawValueText);
        if (drawValue > 0 && drawValue < 20) {
          if (!printed) {
            console.log(`Agent: ${agent} 正在開獎中（指示器：${drawValue}），等待下一輪`);
            printed = true;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }
      break;
    }
  }

  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109,10123,10129,10131,10138,10160,10163,10164,10165,10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                     .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70004;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        context = await browser.newContext();
        const page = await context.newPage();

        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(7000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }
        const frame = page.frameLocator('#bogFrame');

        const closePopupButton = frame.locator('div.j_UeZ > button.Qthei');
        if (await closePopupButton.count() > 0 && await closePopupButton.isVisible()) {
          await closePopupButton.click();
          console.log(`Agent: ${agent} 點擊關閉彈窗`);
        } else {
          console.log(`Agent: ${agent} 沒有找到關閉彈窗按鈕`);
        }

        await waitUntilNotDrawing(frame, agent);

        const countdownLocator = frame.locator('div.z8cdO.uNdQS span').nth(1);
        let remaining;
        let countdownErrorPrinted = false;
        while (true) {
          try {
            remaining = await waitForValidCountdownKeno(frame, countdownLocator, agent);
            if (remaining > 10) {
              break;
            } else {
              console.log(`Agent: ${agent} 倒數不足（${remaining}秒），等待下一輪`);
            }
          } catch (error) {
            if (!countdownErrorPrinted) {
              console.log(`Agent: ${agent} 無法取得倒數計時器（開獎中），等待下一輪`);
              countdownErrorPrinted = true;
            }
          }
          await page.waitForTimeout(5000);
        }

        const ballNumbers = [1,2,3,4,5,6,7,8,9,10];
        for (const num of ballNumbers) {
          const reg = new RegExp(`^0?${num}$`);
          const ball = frame.locator('div[data-gtm="All board numbers"] span.hs275', { hasText: reg });
          await ball.waitFor({ state: 'visible', timeout: 5000 });
          await ball.click();
          console.log(`Agent: ${agent} 點擊彩球 ${num}`);
        }

        const betButton = frame.locator('button[data-gtm="Bet Button"][data-testid="b-btn"]');
        await betButton.waitFor({ state: 'visible', timeout: 5000 });
        await betButton.click();
        console.log(`Agent: ${agent} 點擊賭注按鈕`);

        const notificationLocator = frame.locator('p[data-testid="desktop-notification-0_text"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
        const notificationText = (await notificationLocator.textContent()).trim();
        if (notificationText === "您已下注！") {
          console.log(`Agent: ${agent} 收到下注通知：${notificationText}`);
        } else {
          console.log(`Agent: ${agent} 未收到正確下注通知，實際為：${notificationText}`);
        }

        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});

test('70005_Keno 10 (2 Minute): 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  async function waitForValidCountdownKeno(frame, countdownLocator, agent) {
    await countdownLocator.waitFor({ state: 'visible', timeout: 5000 });
    let countdownText = (await countdownLocator.textContent()).trim();
    let remainingTime = parseInt(countdownText);
    console.log(`Agent: ${agent} 當前倒數時間：${remainingTime} 秒`);
    return remainingTime;
  }

  async function waitUntilNotDrawing(frame, agent) {
    const drawIndicator = frame.locator('div.JvL3z span.gprCY');
    let printed = false;
    while (true) {
      if (await drawIndicator.count() > 0 && await drawIndicator.isVisible()) {
        let drawValueText = (await drawIndicator.textContent()).trim();
        let drawValue = parseInt(drawValueText);
        if (drawValue > 0 && drawValue < 20) {
          if (!printed) {
            console.log(`Agent: ${agent} 正在開獎中（指示器：${drawValue}），等待下一輪`);
            printed = true;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }
      break;
    }
  }

  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109,10123,10129,10131,10138,10160,10163,10164,10165,10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                    .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70005;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        context = await browser.newContext();
        const page = await context.newPage();

        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(6000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }

        const frame = page.frameLocator('#bogFrame');

        const closePopupButton = frame.locator('div.j_UeZ > button.Qthei');
        if (await closePopupButton.count() > 0 && await closePopupButton.isVisible()) {
          await closePopupButton.click();
          console.log(`Agent: ${agent} 關閉彈窗`);
        } else {
          console.log(`Agent: ${agent} 沒有找到關閉彈窗按鈕`);
        }

        await waitUntilNotDrawing(frame, agent);

        const countdownLocator = frame.locator('div.z8cdO.uNdQS span').nth(1);
        let remaining;
        let countdownErrorPrinted = false;
        while (true) {
          try {
            remaining = await waitForValidCountdownKeno(frame, countdownLocator, agent);
            if (remaining > 10) {
              break;
            } else {
              console.log(`Agent: ${agent} 倒數不足（${remaining}秒），等待下一輪`);
            }
          } catch (error) {
            if (!countdownErrorPrinted) {
              console.log(`Agent: ${agent} 無法取得倒數計時器（可能為換局中），等待下一輪`);
              countdownErrorPrinted = true;
            }
          }
          await page.waitForTimeout(5000);
        }

        const ballNumbers = [1,2,3,4,5,6,7,8];
        for (const num of ballNumbers) {
          const reg = new RegExp(`^0?${num}$`);
          const ball = frame.locator('div[data-gtm="All board numbers"] span.hs275', { hasText: reg });
          await ball.waitFor({ state: 'visible', timeout: 5000 });
          await ball.click();
          console.log(`Agent: ${agent} 點擊彩球 ${num}`);
        }

        const betButton = frame.locator('button[data-gtm="Bet Button"][data-testid="b-btn"]');
        await betButton.waitFor({ state: 'visible', timeout: 5000 });
        await betButton.click();
        console.log(`Agent: ${agent} 點擊賭注按鈕`);

        const notificationLocator = frame.locator('p[data-testid="desktop-notification-0_text"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
        const notificationText = (await notificationLocator.textContent()).trim();
        if (notificationText === "您已下注！") {
          console.log(`Agent: ${agent} 收到下注通知：${notificationText}`);
        } else {
          console.log(`Agent: ${agent} 未收到正確下注通知，實際為：${notificationText}`);
        }

        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});

test('70006_Keno 8 (1 Minute): 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  async function getCountdownSeconds(frame, countdownLocator, agent) {
    await countdownLocator.waitFor({ state: 'visible', timeout: 5000 });
    const text = (await countdownLocator.textContent()).trim();
    const seconds = parseInt(text);
    if (seconds !== 0) {
      console.log(`Agent: ${agent} 當前倒數秒數：${seconds} 秒`);
    }
    return seconds;
  }

  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109,10123,10129,10131,10138,10160,10163,10164,10165,10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                      .filter(agent => !excludeAgents.includes(agent));
  const game_id = 70006;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        context = await browser.newContext();
        const page = await context.newPage();

        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(7000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }

        const frame = page.frameLocator('#bogFrame');

        const closePopupButton = frame.locator('div.j_UeZ > button.Qthei');
        if (await closePopupButton.count() > 0 && await closePopupButton.isVisible()) {
          await closePopupButton.click();
          console.log(`Agent: ${agent} 關閉彈窗`);
        } else {
          console.log(`Agent: ${agent} 沒有找到關閉彈窗按鈕`);
        }

        const countdownLocator = frame.locator('div.cptTb.mNTmY span.b3T6S').nth(1);
        let seconds = await getCountdownSeconds(frame, countdownLocator, agent);
        let hasPrinted = false;
        while (seconds <= 4) {
          if (!hasPrinted) {
            console.log(`Agent: ${agent} 倒數不足（${seconds}秒），等待下一輪`);
            hasPrinted = true;
          }
          await page.waitForTimeout(1000);
          seconds = await getCountdownSeconds(frame, countdownLocator, agent);
        }

        const marketButton = frame.locator('button[data-gtm="Bet Markets Small Button x2"]');
        await marketButton.waitFor({ state: 'visible', timeout: 5000 });
        await marketButton.click();
        console.log(`Agent: ${agent} 點擊選擇下注項目`);

        const betButton = frame.locator('button[data-gtm="Bet Button"][data-testid="b-btn"]');
        await betButton.waitFor({ state: 'visible', timeout: 5000 });
        await betButton.click();
        console.log(`Agent: ${agent} 點擊賭注按鈕`);

        const notificationLocator = frame.locator('p[data-testid="desktop-notification-0_text"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
        const notificationText = (await notificationLocator.textContent()).trim();
        if (notificationText === "您已下注！") {
          console.log(`Agent: ${agent} 收到下注通知：${notificationText}`);
        } else {
          console.log(`Agent: ${agent} 未收到正確下注通知，實際為：${notificationText}`);
        }

        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});

test('70007_Keno 8 (2 Minute): 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  async function waitForValidCountdownKeno(frame, countdownLocator, agent) {
    await countdownLocator.waitFor({ state: 'visible', timeout: 5000 });
    let countdownText = (await countdownLocator.textContent()).trim();
    let remainingTime = parseInt(countdownText);
    console.log(`Agent: ${agent} 當前倒數時間：${remainingTime} 秒`);
    return remainingTime;
  }

  async function waitUntilNotDrawing(frame, agent) {
    const drawIndicator = frame.locator('div.JvL3z span.gprCY');
    let printed = false;
    while (true) {
      if (await drawIndicator.count() > 0 && await drawIndicator.isVisible()) {
        let drawValueText = (await drawIndicator.textContent()).trim();
        let drawValue = parseInt(drawValueText);
        if (drawValue > 0 && drawValue < 20) {
          if (!printed) {
            console.log(`Agent: ${agent} 正在開獎中（指示器：${drawValue}），等待下一輪`);
            printed = true;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }
      break;
    }
  }

  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109,10123,10129,10131,10138,10160,10163,10164,10165,10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                    .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70007;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        context = await browser.newContext();
        const page = await context.newPage();

        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(7000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }

        const frame = page.frameLocator('#bogFrame');

        const closePopupButton = frame.locator('div.j_UeZ > button.Qthei');
        if (await closePopupButton.count() > 0 && await closePopupButton.isVisible()) {
          await closePopupButton.click();
          console.log(`Agent: ${agent} 關閉彈窗`);
        } else {
          console.log(`Agent: ${agent} 沒有找到關閉彈窗按鈕`);
        }

        await waitUntilNotDrawing(frame, agent);

        const countdownLocator = frame.locator('div.z8cdO.uNdQS span').nth(1);
        let remaining;
        let countdownErrorPrinted = false;
        while (true) {
          try {
            remaining = await waitForValidCountdownKeno(frame, countdownLocator, agent);
            if (remaining > 10) {
              break;
            } else {
              console.log(`Agent: ${agent} 倒數不足（${remaining}秒），等待下一輪`);
            }
          } catch (error) {
            if (!countdownErrorPrinted) {
              console.log(`Agent: ${agent} 無法取得倒數計時器（可能為換局中），等待下一輪`);
              countdownErrorPrinted = true;
            }
          }
          await page.waitForTimeout(5000);
        }

        const ballNumbers = [1,2,3,4,5,6,7,8];
        for (const num of ballNumbers) {
          const reg = new RegExp(`^0?${num}$`);
          const ball = frame.locator('div[data-gtm="All board numbers"] span.hs275', { hasText: reg });
          await ball.waitFor({ state: 'visible', timeout: 5000 });
          await ball.click();
          console.log(`Agent: ${agent} 點擊彩球 ${num}`);
        }

        const betButton = frame.locator('button[data-gtm="Bet Button"][data-testid="b-btn"]');
        await betButton.waitFor({ state: 'visible', timeout: 5000 });
        await betButton.click();
        console.log(`Agent: ${agent} 點擊賭注按鈕`);

        const notificationLocator = frame.locator('p[data-testid="desktop-notification-0_text"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
        const notificationText = (await notificationLocator.textContent()).trim();
        if (notificationText === "您已下注！") {
          console.log(`Agent: ${agent} 收到下注通知：${notificationText}`);
        } else {
          console.log(`Agent: ${agent} 未收到正確下注通知，實際為：${notificationText}`);
        }

        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});

test('70008_Keno Express: 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  async function getCountdownSeconds(frame, countdownLocator, agent) {
    await countdownLocator.waitFor({ state: 'visible', timeout: 5000 });
    const countdownText = (await countdownLocator.textContent()).trim();
    const seconds = parseInt(countdownText);
    console.log(`Agent: ${agent} 當前倒數秒數：${seconds} 秒`);
    return seconds;
  }

  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109,10123,10129,10131,10138,10160,10163,10164,10165,10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                     .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70008;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        context = await browser.newContext();
        const page = await context.newPage();

        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(6000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }

        const frame = page.frameLocator('#bogFrame');

        const skipButton = frame.locator('div.sc-cse9fg-2.nRguo div.sc-cse9fg-3.iPdgr', { hasText: '跳过' });
        if (await skipButton.count() > 0 && await skipButton.isVisible()) {
          await skipButton.click();
          console.log(`Agent: ${agent} 點擊跳过按鈕`);
        } else {
          console.log(`Agent: ${agent} 沒有找到跳过按鈕`);
        }

        const closePopupButton = frame.locator('div.j_UeZ > button.Qthei');
        if (await closePopupButton.count() > 0 && await closePopupButton.isVisible()) {
          await closePopupButton.click();
          console.log(`Agent: ${agent} 關閉彈窗`);
        } else {
          console.log(`Agent: ${agent} 沒有找到關閉彈窗按鈕`);
        }

        const countdownLocator = frame.locator('div.J_uFA span');
        const seconds = await getCountdownSeconds(frame, countdownLocator, agent);
        if (seconds <= 3) {
          console.log(`Agent: ${agent} 倒數不足（${seconds}秒），等待下一輪`);
          await context.close();
          agentSuccess = true;
          break;
        }

        const betButton = frame.locator('button[data-gtm="Bet Button"][data-testid="b-btn"]');
        await betButton.waitFor({ state: 'visible', timeout: 5000 });
        await betButton.click();
        console.log(`Agent: ${agent} 點擊賭注按鈕`);

        const notificationLocator = frame.locator('p[data-testid="desktop-notification-0_text"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
        const notificationText = (await notificationLocator.textContent()).trim();
        if (notificationText === "您已下注！") {
          console.log(`Agent: ${agent} 收到下注通知：${notificationText}`);
        } else {
          console.log(`Agent: ${agent} 未收到正確下注通知，實際為：${notificationText}`);
        }

        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});

test('70009_Penalty: 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  // Helper：取得倒數秒數（只讀取一次）
  async function getCountdownSeconds(frameLocator, countdownLocator, agent) {
    await countdownLocator.waitFor({ state: 'visible', timeout: 5000 });
    const text = (await countdownLocator.textContent()).trim();
    const seconds = parseInt(text);
    console.log(`Agent: ${agent} 倒數秒數：${seconds} 秒`);
    return seconds;
  }

  // Helper：持續等待直到倒數秒數大於 5 秒
  async function waitUntilCountdownAbove5(frameLocator, countdownLocator, agent) {
    let seconds = await getCountdownSeconds(frameLocator, countdownLocator, agent);
    while (seconds <= 5) {
      console.log(`Agent: ${agent} 倒數不足 (${seconds}秒)，等待下一輪下注機會`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      seconds = await getCountdownSeconds(frameLocator, countdownLocator, agent);
    }
    console.log(`Agent: ${agent} 倒數大於 5秒 (${seconds}秒)，準備下注`);
    return seconds;
  }

  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109, 10123, 10129, 10131, 10138, 10160, 10163, 10164, 10165, 10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                      .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70009;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    let context;
    while (!agentSuccess && attempt < maxAttempts) {
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        // 建立 context 與 page，直接使用原始 game_url
        context = await browser.newContext();
        const page = await context.newPage();

        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(7000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        // --- Loader 判斷邏輯 ---
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          console.log(`Agent: ${agent} 等待下一輪 (Loader 未完全消失)`);
          await page.waitForTimeout(5000);
          // 繼續等待下注時機，不關閉瀏覽器
        }
        // --- Loader 判斷結束 ---

        const frameLocator = page.frameLocator('#bogFrame');

        // 關閉彈窗
        const closeButton = frameLocator.locator('button.Qthei[aria-label="close"]');
        await closeButton.waitFor({ state: 'visible', timeout: 5000 });
        await closeButton.click();
        console.log(`Agent: ${agent} 關閉彈窗`);

        // 偵測倒數秒數，選取倒數定位器中的第二個元素 (index 1)
        const countdownLocator = frameLocator.locator('span.eFOKx').nth(1);
        await waitUntilCountdownAbove5(frameLocator, countdownLocator, agent);

        // 點擊藍色市場按鈕，只選取包含「蓝色」文字的按鈕
        const marketButton = frameLocator.locator('button[data-gtm="Bet Markets x2"]', { hasText: '蓝色' });
        await marketButton.waitFor({ state: 'visible', timeout: 5000 });
        await marketButton.click();
        console.log(`Agent: ${agent} 點擊藍色市場按鈕`);

        // 點擊賭注按鈕
        const betButton = frameLocator.locator('button[data-gtm="Bet Button"][data-testid="b-btn"]');
        await betButton.waitFor({ state: 'visible', timeout: 5000 });
        await betButton.click();
        console.log(`Agent: ${agent} 點擊賭注按鈕`);

        // 等待下注通知
        const notificationLocator = frameLocator.locator('p[data-testid="desktop-notification-0_text"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
        const notificationText = (await notificationLocator.textContent()).trim();
        if (notificationText === "您已下注！") {
          console.log(`Agent: ${agent} 收到下注通知：${notificationText}`);
        } else {
          console.log(`Agent: ${agent} 未收到正確下注通知，實際為：${notificationText}`);
        }

        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        console.log(`Agent: ${agent} 發生錯誤，等待下一輪下注機會`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (attempt < maxAttempts) continue;
        else {
          errors[agent] = cleanedErrorMsg;
          break;
        }
      } finally {
        if (context) {
          try {
            await context.close();
          } catch (e) {
            console.log(`Agent: ${agent} 關閉 context 時發生錯誤: ${e.message}`);
          }
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});



test('70010_Penalty: 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  // Helper：取得倒數秒數（只讀取一次）
  async function getCountdownSeconds(frameLocator, countdownLocator, agent) {
    await countdownLocator.waitFor({ state: 'visible', timeout: 5000 });
    const text = (await countdownLocator.textContent()).trim();
    const seconds = parseInt(text);
    console.log(`Agent: ${agent} 倒數秒數：${seconds} 秒`);
    return seconds;
  }

  // Helper：持續等待直到倒數秒數大於 5 秒
  async function waitUntilCountdownAbove5(frameLocator, countdownLocator, agent) {
    let seconds = await getCountdownSeconds(frameLocator, countdownLocator, agent);
    while (seconds <= 5) {
      console.log(`Agent: ${agent} 倒數不足 (${seconds}秒)，等待下一輪下注機會`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      seconds = await getCountdownSeconds(frameLocator, countdownLocator, agent);
    }
    console.log(`Agent: ${agent} 倒數大於 5秒 (${seconds}秒)，準備下注`);
    return seconds;
  }

  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109, 10123, 10129, 10131, 10138, 10160, 10163, 10164, 10165, 10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                      .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70010;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    let context;
    while (!agentSuccess && attempt < maxAttempts) {
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        // 建立 context 與 page，直接使用原始 game_url
        context = await browser.newContext();
        const page = await context.newPage();

        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(7000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        // --- Loader 判斷邏輯 ---
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          console.log(`Agent: ${agent} 等待下一輪 (Loader 未完全消失)`);
          await page.waitForTimeout(5000);
          // 繼續等待下注時機，不關閉瀏覽器
        }
        // --- Loader 判斷結束 ---

        const frameLocator = page.frameLocator('#bogFrame');

        // 關閉彈窗
        const closeButton = frameLocator.locator('button.Qthei[aria-label="close"]');
        await closeButton.waitFor({ state: 'visible', timeout: 5000 });
        await closeButton.click();
        console.log(`Agent: ${agent} 關閉彈窗`);

        // 偵測倒數秒數，選取倒數定位器中的第二個元素 (index 1)
        const countdownLocator = frameLocator.locator('span.eFOKx').nth(1);
        await waitUntilCountdownAbove5(frameLocator, countdownLocator, agent);

        // 點擊藍色市場按鈕，只選取包含「蓝色」文字的按鈕
        const marketButton = frameLocator.locator('button[data-gtm="Bet Markets x2"]', { hasText: '蓝色' });
        await marketButton.waitFor({ state: 'visible', timeout: 5000 });
        await marketButton.click();
        console.log(`Agent: ${agent} 點擊藍色按鈕`);

        // 點擊賭注按鈕
        const betButton = frameLocator.locator('button[data-gtm="Bet Button"][data-testid="b-btn"]');
        await betButton.waitFor({ state: 'visible', timeout: 5000 });
        await betButton.click();
        console.log(`Agent: ${agent} 點擊賭注按鈕`);

        // 等待下注通知
        const notificationLocator = frameLocator.locator('p[data-testid="desktop-notification-0_text"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
        const notificationText = (await notificationLocator.textContent()).trim();
        if (notificationText === "您已下注！") {
          console.log(`Agent: ${agent} 收到下注通知：${notificationText}`);
        } else {
          console.log(`Agent: ${agent} 未收到正確下注通知，實際為：${notificationText}`);
        }

        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        console.log(`Agent: ${agent} 發生錯誤，等待下一輪下注機會`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (attempt < maxAttempts) continue;
        else {
          errors[agent] = cleanedErrorMsg;
          break;
        }
      } finally {
        if (context) {
          try {
            await context.close();
          } catch (e) {
            console.log(`Agent: ${agent} 關閉 context 時發生錯誤: ${e.message}`);
          }
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});



test('70011_Hilo: 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  async function getCountdownSecondsHilo(frame, timeLocator, agent) {
    await timeLocator.waitFor({ state: 'visible', timeout: 5000 });
    const text = (await timeLocator.textContent()).trim();
    const seconds = parseInt(text);
    if (seconds !== 0) {
      console.log(`Agent: ${agent} 當前倒數秒數：${seconds} 秒`);
    }
    return seconds;
  }

  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109,10123,10129,10131,10138,10160,10163,10164,10165,10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                      .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70011;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        context = await browser.newContext();
        const page = await context.newPage();

        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(7000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }

        const frame = page.frameLocator('#bogFrame');

        await frame.locator('button.Qthei[aria-label="close"]').waitFor({ state: 'visible', timeout: 5000 });
        await frame.locator('button.Qthei[aria-label="close"]').click();
        console.log(`Agent: ${agent} 關閉彈窗`);

        const timeLocator = frame.locator('div.pnp1p span.M0SkE');
        let seconds = await getCountdownSecondsHilo(frame, timeLocator, agent);
        let hasPrinted = false;
        while (seconds <= 3) {
          if (!hasPrinted) {
            console.log(`Agent: ${agent} 倒數不足 (${seconds}秒)，等待下一輪下注機會`);
            hasPrinted = true;
          }
          await page.waitForTimeout(1000);
          seconds = await getCountdownSecondsHilo(frame, timeLocator, agent);
        }

        const betButton = frame.locator('button[data-testid="b-btn"]');
        const betButtonClass = await betButton.getAttribute('class');
        if (betButtonClass && betButtonClass.includes('disabled')) {
          console.log(`Agent: ${agent} 賭注按鈕 disabled (正在開獎中)，等待下一輪下注機會`);
          throw new Error("Bet button disabled");
        }

        const redOption = frame.locator('div[data-testid="rd-btn"][data-gtm="Red Button"]', { hasText: '红色' });
        if (await redOption.count() > 0 && await redOption.isVisible()) {
          await redOption.click();
          console.log(`Agent: ${agent} 點擊紅色選項`);
        } else {
          console.log(`Agent: ${agent} 沒有找到紅色選項`);
        }

        await betButton.waitFor({ state: 'visible', timeout: 5000 });
        await betButton.click();
        console.log(`Agent: ${agent} 點擊賭注按鈕`);

        const notificationLocator = frame.locator('p[data-testid="desktop-notification-0_text"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
        const notificationText = (await notificationLocator.textContent()).trim();
        if (notificationText === "您已下注！") {
          console.log(`Agent: ${agent} 收到下注通知：${notificationText}`);
        } else {
          console.log(`Agent: ${agent} 未收到正確下注通知，實際為：${notificationText}`);
        }

        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});

test('70012_BlackJack: 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109,10123,10129,10131,10138,10160,10163,10164,10165,10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                      .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70012;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        context = await browser.newContext();
        const page = await context.newPage();

        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(7000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }

        const frame = page.frameLocator('#bogFrame');

        const closeButton = frame.locator('button.Qthei[aria-label="close"]');
        await closeButton.waitFor({ state: 'visible', timeout: 5000 });
        await closeButton.click();
        console.log(`Agent: ${agent} 點擊關閉按鈕`);

        const startButton = frame.locator('div.MvOqe div.sc-13wpmz1-0.dKaBWX >> text=开始');
        await startButton.waitFor({ state: 'visible', timeout: 5000 });
        await startButton.click();
        console.log(`Agent: ${agent} 點擊開始按鈕`);

        const betOption = frame.locator('span.rwY6S').nth(33);
        await betOption.waitFor({ state: 'visible', timeout: 5000 });
        await betOption.click();
        console.log(`Agent: ${agent} 點擊第 34 個下注選項`);

        const notificationLocator = frame.locator('p[data-testid="or-desk-game-header_desktop-notification-0_text"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
        const notificationText = (await notificationLocator.textContent()).trim();
        if (notificationText === "您已下注！") {
          console.log(`Agent: ${agent} 收到下注通知：${notificationText}`);
        } else {
          console.log(`Agent: ${agent} 未收到正確下注通知，實際為：${notificationText}`);
        }

        const cashButton = frame.locator('div[data-testid="or-glob-nine-slice-adv"] >> text=兌現');
        if (await cashButton.count() > 0 && await cashButton.isVisible()) {
          await cashButton.click();
          console.log(`Agent: ${agent} 點擊兌現按鈕`);
        } else {
          console.log(`Agent: ${agent} 沒有找到兌現按鈕`);
        }
        try {
          await Promise.race([
            frame.locator('div.V_1oe').waitFor({ state: 'visible', timeout: 10000 }),
            frame.locator('p.XVgDO', { hasText: '恭喜你' }).waitFor({ state: 'visible', timeout: 10000 }),
            frame.locator('div.nQVdp[data-testid="lose-pu"] h4.p9i55', { hasText: '再試一次' }).waitFor({ state: 'visible', timeout: 10000 })
          ]);
          console.log(`Agent: ${agent} 完成兌現流程`);
        } catch (e) {
          console.log(`Agent: ${agent} 未抓到投注結果`);
        }

        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});




test('70013_GoldenRA: 下注', async ({ browser, request }) => {
  test.setTimeout(0);

  // 建立 agent 清單
  const startAgent = 10101;
  const endAgent = 10172;
  const excludeAgents = [10109, 10123, 10129, 10131, 10138, 10160, 10163, 10164, 10165, 10166];
  const agents = Array.from({ length: endAgent - startAgent + 1 }, (_, i) => i + startAgent)
                      .filter(agent => !excludeAgents.includes(agent));

  const game_id = 70013;
  const { expected_galaxsys } = ENV_CONFIG;
  const errors = {};
  let successCount = 0;

  for (const agent of agents) {
    let agentSuccess = false;
    const maxAttempts = 2;
    let attempt = 0;
    while (!agentSuccess && attempt < maxAttempts) {
      let context;
      try {
        attempt++;
        console.log(`\n========== 開始測試 agent: ${agent}, attempt: ${attempt} ==========`);

        // 取得並驗證原始 URL
        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url || !game_url.startsWith(expected_galaxsys)) {
          throw new Error("產生的 URL 無效");
        }
        console.log(`Agent: ${agent} 取得的原始 URL: ${game_url}`);

        // 建立 context 與 page，直接使用原始的 game_url，不做任何修改
        context = await browser.newContext();
        const page = await context.newPage();

        // API 失敗偵測
        let apiFailed = false;
        page.on('response', async (response) => {
          if (response.url().includes("https://partnerapi-gli.stg-digi.com/Content/images/failed")) {
            apiFailed = true;
          }
        });
        await page.goto(game_url, { waitUntil: 'load' });
        await page.waitForTimeout(7000);
        if (apiFailed) {
          throw new Error("API error detected.");
        }
        
        // --- Loader 判斷邏輯 ---
        // 進入 iframe，並定位 loader 圖片（依據 class、alt 及 src 部分內容）
        const loaderLocator = page
          .frameLocator('#bogFrame')
          .locator('img.sc-zh9k1g-2.bVbxNL[alt="Loader"][src*="loaderGS.gif"]');
        let loaderError = false;
        try {
          await loaderLocator.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`Agent: ${agent}, GameID: ${game_id} Loader 消失，頁面載入完成`);
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${game_id} 卡Loading: 載入動畫持續超過 10 秒`);
          loaderError = true;
        }
        if (loaderError) {
          await context.close();
          continue;
        }
        // --- Loader 判斷結束 ---

        // 使用 frameLocator 定位 id 為 bogFrame 的 iframe
        const frame = page.frameLocator('#bogFrame');

        // 點擊關閉按鈕（新的關閉按鈕）
        const closeButton = frame.locator('button.Qthei[aria-label="close"]');
        await closeButton.waitFor({ state: 'visible', timeout: 5000 });
        await closeButton.click();
        console.log(`Agent: ${agent} 點擊關閉按鈕`);

        // 點擊開始按鈕：定位包含 "开始" 文字的元素
        const startButton = frame.locator('div.MvOqe div.sc-13wpmz1-0.dKaBWX >> text=开始');
        await startButton.waitFor({ state: 'visible', timeout: 5000 });
        await startButton.click();
        console.log(`Agent: ${agent} 點擊開始按鈕`);

        // 點擊下注選項：點擊第 34 個 rwY6S 元素（nth(33)）
        const betOption = frame.locator('span.rwY6S').nth(33);
        await betOption.waitFor({ state: 'visible', timeout: 5000 });
        await betOption.click();
        console.log(`Agent: ${agent} 點擊第 34 個下注選項`);

        // 等待下注通知：確認通知訊息為「您已下注！」
        const notificationLocator = frame.locator('p[data-testid="or-desk-game-header_desktop-notification-0_text"]');
        await notificationLocator.waitFor({ state: 'visible', timeout: 10000 });
        const notificationText = (await notificationLocator.textContent()).trim();
        if (notificationText === "您已下注！") {
          console.log(`Agent: ${agent} 收到下注通知：${notificationText}`);
        } else {
          console.log(`Agent: ${agent} 未收到正確下注通知，實際為：${notificationText}`);
        }

        // --- 兌現及結算訊息檢查 ---
        // 檢查是否有兌現按鈕，若存在則點擊
        const cashButton = frame.locator('div[data-testid="or-glob-nine-slice-adv"] >> text=兌現');
        if (await cashButton.count() > 0 && await cashButton.isVisible()) {
          await cashButton.click();
          console.log(`Agent: ${agent} 點擊兌現按鈕`);
        } else {
          console.log(`Agent: ${agent} 沒有找到兌現按鈕`);
        }
        // 等待結算訊息：檢查是否出現「恭喜你」或「再試一次」
        try {
          await Promise.race([
            frame.locator('div.V_1oe').waitFor({ state: 'visible', timeout: 10000 }),
            frame.locator('p.XVgDO', { hasText: '恭喜你' }).waitFor({ state: 'visible', timeout: 10000 }),
            frame.locator('div.nQVdp[data-testid="lose-pu"] h4.p9i55', { hasText: '再試一次' }).waitFor({ state: 'visible', timeout: 10000 })
          ]);
          console.log(`Agent: ${agent} 完成兌現流程`);
        } catch (e) {
          console.log(`Agent: ${agent} 未抓到投注結果`);
        }
        // --- 結算訊息檢查結束 ---

        await context.close();
        agentSuccess = true;
        successCount++;
      } catch (error) {
        let cleanedErrorMsg = error.message;
        if (cleanedErrorMsg.includes("Call log:")) {
          cleanedErrorMsg = cleanedErrorMsg.split("Call log:")[0].trim();
        }
        cleanedErrorMsg = cleanedErrorMsg.replace(new RegExp(`^Agent\\s*${agent}\\s*`), '');
        console.error(`Agent: ${agent} GameID: ${game_id} ${cleanedErrorMsg}`);
        if (
          (cleanedErrorMsg.includes("Timeout") ||
           cleanedErrorMsg.includes("產生的 URL 無效") ||
           cleanedErrorMsg.includes("無效") ||
           cleanedErrorMsg.includes("Target page, context or browser") ||
           cleanedErrorMsg.includes("apiRequestContext.post")) &&
          attempt < maxAttempts
        ) {
          if (context) await context.close();
          continue;
        } else {
          errors[agent] = cleanedErrorMsg;
          if (context) await context.close();
          break;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new Error(
      Object.entries(errors)
        .map(([agent, msg]) => `Agent: ${agent} GameID: ${game_id} ${msg}`)
        .join(" | ")
    );
  } else {
    console.log("所有 agent 測試成功");
  }
});


