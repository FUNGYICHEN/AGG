import fs from 'fs/promises';
import axios from 'axios';

/**
 * 解析測試日誌檔，回傳成功訊息與錯誤訊息字串。
 * @param {string} filePath 日誌檔案的路徑
 * @returns {{ successMessage: string, errorMessage: string }}
 */
async function parseLogFile(filePath) {
  // 讀取整個日誌檔內容
  const data = await fs.readFile(filePath, 'utf8');
  const lines = data.split(/\r?\n/);

  // 從路徑取得環境名稱，例如 (PROD) 轉換為 'prod'
  const envMatch = filePath.match(/\(([^)]+)\)/);
  const env = envMatch ? envMatch[1].toLowerCase() : '';

  const successLines = [];
  const errorsByBrand = {};

  // 分析每一行，分類成功與錯誤
  for (const line of lines) {
    if (line.includes('所有 agent 測試成功')) {
      // 收集成功訊息行
      successLines.push(line.trim());
    } else if (line.includes('HTTP錯誤')) {
      // 利用正則解析錯誤行資訊
      const match = line.match(/^(.+?) URL 錯誤：\s*Agent:\s*(\d+),\s*GameID:\s*(\d+)\s*HTTP錯誤：狀態碼\s*(\d+)/);
      if (!match) continue;
      const [, brand, agent, gameId, code] = match;
      // 初始化該品牌的錯誤集合容器
      if (!errorsByBrand[brand]) {
        errorsByBrand[brand] = {};
      }
      // 構造唯一鍵值 (Agent/GameID/Code 組合) 並計數
      const errorKey = `Agent: ${agent}, GameID: ${gameId} HTTP錯誤：狀態碼 ${code}`;
      errorsByBrand[brand][errorKey] = (errorsByBrand[brand][errorKey] || 0) + 1;
    }
  }

  // 組合成功訊息文字
  let successMessage = `✅ 測試成功 (${env})\n`;
  successMessage += successLines.join('\n');

  // 組合錯誤訊息文字
  let errorMessage = `❌ 測試錯誤 (${env})\n`;
  for (const brand in errorsByBrand) {
    errorMessage += `${brand} URL 錯誤：\n`;
    // 列出該品牌所有錯誤明細
    for (const errorKey in errorsByBrand[brand]) {
      const count = errorsByBrand[brand][errorKey];
      errorMessage += `    ${errorKey} (共 ${count} 個)\n`;
    }
  }
  errorMessage = errorMessage.trim();  // 移除最後一個換行符號

  return { successMessage, errorMessage };
}

/**
 * 使用 Telegram Bot API 發送訊息到指定聊天。
 * @param {string} botToken 機器人存取權杖
 * @param {string|number} chatId 目標 chat 的 ID
 * @param {string} text 欲傳送的文字內容
 */
async function sendTelegramMessage(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  // 發送 POST 請求
  await axios.post(url, {
    chat_id: chatId,
    text: text
  });
}

// 主執行流程：讀取日誌、解析內容、傳送 Telegram 通知
async function main() {
  try {
    const filePath = 'C:\\Users\\as268\\jenkins_agent\\workspace\\AGG_URL(PROD)\\test.log';
    const { successMessage, errorMessage } = await parseLogFile(filePath);

    // 直接帶入參數
    const botToken = 'botW7881684321:AAFGknNFikAsRyb1OVaALUby_xPwdRg4Elw';
    const chatId = '-4707429750';

    // 傳送成功與錯誤摘要訊息
    await sendTelegramMessage(botToken, chatId, successMessage);
    await sendTelegramMessage(botToken, chatId, errorMessage);

    console.log('✅ 日誌分析結果已透過 Telegram 發送');
  } catch (err) {
    console.error('腳本執行發生錯誤：', err);
  }
}

main();
