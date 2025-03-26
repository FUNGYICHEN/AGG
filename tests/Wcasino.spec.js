import { test } from '@playwright/test';

const env = process.env.NODE_ENV || 'stg';
const configModule = await import(`./${env}環境.js`);
const { ENV_CONFIG, generateGameUrl } = configModule;

// 定義 range 函式：產生從 start 到 end-1 的數字陣列
const range = (start, end) => Array.from({ length: end - start }, (_, i) => start + i);



test('Wcasino下注測試', async ({ browser, request }) => {
  test.setTimeout(0);
  const { expected_Wcasino, accountPrefix } = ENV_CONFIG;

  // 建立遊戲 ID 清單：60001 ~ 60024，排除 exceptions 中的數字
  const exceptions = [60013, 60014, 60019, 60022, 60023];
  const gameIds = Array.from({ length: 24 }, (_, i) => 60001 + i)
    .filter(id => !exceptions.includes(id));

  // 建立 agent 清單：合併兩個範圍
  // 範圍1：11101 ~ 11172（排除 11138），需要打錢包 10000
  const agents_111 = Array.from({ length: 11172 - 11101 + 1 }, (_, i) => 11101 + i)
    .filter(agent => agent !== 11138);
  // 範圍2：10111 ~ 10172，不需要打錢包
  const agents_101 = Array.from({ length: 10172 - 10111 + 1 }, (_, i) => 10111 + i);
  const agents = [...agents_111, ...agents_101];

  let errorMessages = [];

  for (const agent of agents) {
    for (const gameId of gameIds) {
      let hasDeposited = false;  // 若遇到餘額歸0，就不再重複打錢包
      let success = false;
      let retryCount = 0;
      // 最多重試 3 次
      while (!success && retryCount < 3) {
        retryCount++;
        let context;
        try {
          // 取得遊戲 URL 並檢查前綴是否正確
          let game_url = await generateGameUrl(request, agent, gameId);
          if (!game_url || !game_url.startsWith(expected_Wcasino)) {
            throw new Error(`URL 前綴不符 -> ${game_url}`);
          }
          console.log(`Agent: ${agent}, GameID: ${gameId} 取得的 URL: ${game_url}`);

          // 產生下注帳號，使用 ENV_CONFIG 中的 accountPrefix
          const ACCOUNT = `${accountPrefix}${agent}${gameId}`;
          console.log(`下注帳號: ${ACCOUNT}`);

          // 根據 agent 判斷是否需要打錢包（若 agent 在 11101～11172 範圍內則 deposit 10000）
          let depositAmount = (agent >= 11101 && agent <= 11172) ? 10000 : 0;
          if (depositAmount > 0 && !hasDeposited) {
            await depositMoney(request, ACCOUNT, agent, depositAmount);
            hasDeposited = true;
            console.log(`Agent: ${agent}, GameID: ${gameId} 增加錢包餘額：${depositAmount}`);
          } else {
            console.log(`Agent: ${agent}, GameID: ${gameId} 不需要增加餘額或已增加`);
          }

          // 進入遊戲頁面
          context = await browser.newContext({ headless: true });
          const page = await context.newPage();
          await page.goto(game_url, { waitUntil: 'load' });
          // 等待頁面與 iframe 載入完成（等待 10000 毫秒）
          await page.waitForTimeout(10000);

          // 設置 console 監聽器，檢查是否有 account 變成 0 的訊息
          let accountZeroDetected = false;
          page.on('console', msg => {
            const text = msg.text();
            if (text.includes("account:0") || /account:\s*0(\.0+)?/.test(text)) {
              accountZeroDetected = true;
              console.log(`Agent: ${agent}, GameID: ${gameId} 餘額歸0`);
            }
          });

          // 監聽 response，檢查是否有觸發 startbets API
          let startBetsDetected = false;
          page.on('response', async (response) => {
            const url = response.url();
            if (url.includes("assets/zh-cn/audio/baccarat/31/startbets.mp3")) {
              console.log(`Agent: ${agent}, GameID: ${gameId} Detected startbets API: ${url}`);
              startBetsDetected = true;
            }
          });

          // 持續等待最多 60 秒，每秒檢查一次，若等待期間檢測到 account 歸0則立即拋錯
          let waited = 0;
          while (!startBetsDetected && waited < 3500000) {
            await page.waitForTimeout(1000);
            waited += 1000;
            if (accountZeroDetected) {
              throw new Error("餘額歸0");
            }
          }
          if (!startBetsDetected) {
            throw new Error("未等到Startbets API");
          } else {
            console.log(`Agent: ${agent}, GameID: ${gameId} Startbets API detected, 等待 2000 毫秒後開始下注`);
          }
          // 等待 2000 毫秒後開始下注
          await page.waitForTimeout(2000);
          // 再次檢查下注前是否發現 account 歸0
          if (accountZeroDetected) {
            throw new Error("餘額歸0");
          }

          // === 使用 canvas 相對座標點擊 ===
          // 嘗試取得 canvas 元素，假設 canvas 的 id 為 "layaCanvas"
          const canvas = await page.$('#layaCanvas');
          if (!canvas) {
            throw new Error("找不到遊戲 canvas");
          }
          const box = await canvas.boundingBox();
          if (!box) {
            throw new Error("無法取得 canvas bounding box");
          }
          console.log(`Agent: ${agent}, GameID: ${gameId} Canvas bounding box: ${JSON.stringify(box)}`);

          // 點擊籌碼位置相對於 canvas 的位置
          const chipX = box.x + 699;
          const chipY = box.y + 693;
          await page.mouse.click(chipX, chipY);
          console.log("點擊籌碼 (相對座標)");
          await page.waitForTimeout(1000);

          // 點擊下注位置相對於 canvas 的位置
          const betX = box.x + 424;
          const betY = box.y + 613;
          await page.mouse.click(betX, betY);
          console.log("點擊下注 (相對座標)");

          // 監聽 response，檢查是否有觸發 bet API (代表下注音效)
          let betApiDetected = false;
          page.on('response', async (response) => {
            const url = response.url();
            if (url.includes("assets/zh-cn/audio/common/bet.mp3")) {
              console.log(`Agent: ${agent}, GameID: ${gameId} Detected bet API: ${url}`);
              betApiDetected = true;
            }
          });
          // 等待最多 30 秒確認下注 API 是否回應
          for (let i = 0; i < 30 && !betApiDetected; i++) {
            await page.waitForTimeout(1000);
          }
          // 最後再次檢查是否有餘額歸0
          if (accountZeroDetected) {
            throw new Error("餘額歸0");
          }
          if (!betApiDetected) {
            throw new Error("未偵測到Bet API");
          } else {
            console.log(`Agent: ${agent}, GameID: ${gameId} Bet API detected, 下注成功`);
          }
          
          await context.close();
          // 避免連續請求過快，間隔 2000 毫秒
          await new Promise(resolve => setTimeout(resolve, 2000));
          success = true;
        } catch (e) {
          console.log(`Agent: ${agent}, GameID: ${gameId} 第 ${retryCount} 次嘗試失敗: ${e}`);
          if (context) await context.close();
          // 如果捕獲到 "餘額歸0" 或 "未等到Startbets API" 的錯誤，就記錄錯誤並跳出重試
          if (
            e.message.includes("餘額歸0") ||
            e.message.includes("未等到Startbets API")
          ) {
            errorMessages.push(`Agent: ${agent}, GameID: ${gameId} 測試過程發生錯誤: ${e}`);
            continue;
          } else {
            errorMessages.push(`Agent: ${agent}, GameID: ${gameId} 測試過程發生錯誤: ${e}`);
          }
        }
      }
    }
  }

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("所有組合測試成功，正常取得遊戲 URL，並完成下注測試");
  }
});