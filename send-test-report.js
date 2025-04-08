import fs from 'fs/promises';
import axios from 'axios';
import path from 'path';  // 如需處理路徑

/**
 * 解析測試日誌檔，回傳成功與錯誤訊息字串（按品牌分組並彙整錯誤）。
 * @param {string} filePath 日誌檔案的路徑
 * @returns {{ successMessage: string, errorMessage: string }}
 */
async function parseLogFile(filePath) {
  // 讀取整個日誌檔內容
  const data = await fs.readFile(filePath, 'utf8');
  const lines = data.split(/\r?\n/);

  const successLines = [];
  const errorsByBrand = {};
  let currentBrand = null;

  for (const line of lines) {
    // 如果目前在處理某品牌錯誤段落，但遇到不含 "HTTP錯誤" 的行，表示該品牌錯誤段結束
    if (currentBrand && !line.includes('HTTP錯誤')) {
      currentBrand = null;
    }

    // 收集成功訊息行（所有代理皆測試成功）
    if (line.includes('所有 agent 測試成功')) {
      successLines.push(line.trim());
    }

    // 分析錯誤訊息行
    if (line.includes('HTTP錯誤')) {
      if (line.startsWith('Error:')) {
        // 解析帶有品牌名稱的錯誤摘要行 (例如 "Error: Playson URL: Agent: 10199, GameID: 24077 HTTP錯誤：狀態碼 400")
        const match = line.match(/^Error:\s*([^:]+) URL:\s*Agent:\s*(\d+),\s*GameID:\s*(\d+)\s*(?:HTTP狀態碼錯誤:\s*)?HTTP錯誤：狀態碼\s*(\d+)/);
        if (match) {
          const [, brand, agent, gameId, code] = match;
          currentBrand = brand.trim();
          if (!errorsByBrand[currentBrand]) errorsByBrand[currentBrand] = {};
          const errorKey = `Agent: ${agent}, GameID: ${gameId} HTTP錯誤：狀態碼 ${code}`;
          errorsByBrand[currentBrand][errorKey] = (errorsByBrand[currentBrand][errorKey] || 0) + 1;
        }
      } else if (currentBrand && line.trim().startsWith('Agent:')) {
        // 解析錯誤摘要中的後續行 (延續上一行的品牌錯誤資訊)
        const match = line.match(/Agent:\s*(\d+),\s*GameID:\s*(\d+)\s*(?:HTTP狀態碼錯誤:\s*)?HTTP錯誤：狀態碼\s*(\d+)/);
        if (match) {
          const [, agent, gameId, code] = match;
          if (!errorsByBrand[currentBrand]) errorsByBrand[currentBrand] = {};
          const errorKey = `Agent: ${agent}, GameID: ${gameId} HTTP錯誤：狀態碼 ${code}`;
          errorsByBrand[currentBrand][errorKey] = (errorsByBrand[currentBrand][errorKey] || 0) + 1;
        }
      } else if (!currentBrand && line.trim().startsWith('Agent:')) {
        // 獨立的 Agent 錯誤行且尚未設定品牌（通常在錯誤摘要中已包含，這裡略過以避免重複）
        continue;
      }
    }
  }

  // 組合【成功訊息】文字
  let successMessage = `【成功訊息】\n`;
  if (successLines.length > 0) {
    successMessage += successLines.join('\n');
  } else {
    successMessage += '（無成功項目）';
  }

  // 組合【錯誤訊息】文字
  let errorMessage = `【錯誤訊息】\n`;
  if (Object.keys(errorsByBrand).length === 0) {
    errorMessage += '（無錯誤項目）';
  } else {
    for (const brand in errorsByBrand) {
      errorMessage += `${brand} URL 錯誤：\n`;
      // 列出該品牌的所有錯誤明細（每項附帶發生次數）
      for (const errorKey in errorsByBrand[brand]) {
        const count = errorsByBrand[brand][errorKey];
        errorMessage += `  ${errorKey} (共 ${count} 個)\n`;
      }
    }
    errorMessage = errorMessage.trim();  // 移除最後多餘的換行
  }

  return { successMessage, errorMessage };
}

/**
 * 使用 Telegram Bot API 發送訊息到指定聊天。
 * @param {string} botToken 機器人存取權杖
 * @param {string|number} chatId 目標聊天的 ID
 * @param {string} text 欲傳送的文字內容
 */
async function sendTelegramMessage(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  // 發送 POST 請求給 Telegram Bot API
  await axios.post(url, {
    chat_id: chatId,
    text: text
  });
}

// 主執行流程：讀取日誌、解析內容並傳送 Telegram 通知
(async () => {
  try {
    // 設定待分析的日誌檔路徑（預設為當前工作目錄下的 test.log）
    const filePath = path.join(process.cwd(), 'test.log');
    const { successMessage, errorMessage } = await parseLogFile(filePath);

    // 設定 Telegram Bot 憑證與聊天室 ID（請填入實際值）
    const botToken = 'W7881684321:AAFGknNFikAsRyb1OVaALUby_xPwdRg4Elw';    // 例如 '123456789:ABCDefGhIJKlmNoPQRstuVwxyz'
    const chatId   = '-4707429750';                 // 目標 Telegram Chat 的 ID

    // 傳送成功與錯誤摘要訊息至 Telegram
    const finalMessage = `${successMessage}\n\n${errorMessage}`;
    await sendTelegramMessage(botToken, chatId, finalMessage);

    console.log('✅ 已分析日誌並透過 Telegram 發送測試報告');
  } catch (err) {
    console.error('腳本執行發生錯誤：', err);
  }
})();