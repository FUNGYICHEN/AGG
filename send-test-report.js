const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const FormData = require('form-data');

// 從環境變數取得 Telegram 憑證（Jenkins Credentials 注入）
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 用來發送純文字訊息到 Telegram
async function sendTelegramMessage(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Telegram 憑證未正確設定！');
    return;
  }
  try {
    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    console.log('Telegram 訊息已發送：', response.data);
  } catch (error) {
    console.error('發送 Telegram 訊息失敗：', error.message);
  }
}

// 讀取 HTML 報告內容，並回傳純文字
function readHtmlReport(reportPath) {
  try {
    const html = fs.readFileSync(reportPath, 'utf-8');
    // 使用 cheerio 去除 HTML 標籤
    const $ = cheerio.load(html);
    // 取得 body 內全部文字（或視情況選擇特定區塊）
    const text = $('body').text();
    return text;
  } catch (error) {
    console.error('讀取 HTML 報告失敗：', error.message);
    return null;
  }
}

// 將報告純文字依行切分，並過濾空白行
function extractLines(reportText) {
  return reportText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
}

/**
 * 解析錯誤訊息行：
 * 假定格式為:
 *   TestSuiteName 錯誤：Agent: 10199, GameID: 24077 HTTP錯誤：狀態碼 400
 * 傳回物件 { suite, agent, gameId, errorDetail }
 */
function parseErrorLine(line) {
  const regex = /^(.*?)[:：]\s*Agent:\s*(\d+),\s*GameID:\s*(\d+).*?(HTTP錯誤：狀態碼\s*\d+)/;
  const match = line.match(regex);
  if (match) {
    return {
      suite: match[1].trim(),
      agent: match[2].trim(),
      gameId: match[3].trim(),
      errorDetail: match[4].trim()
    };
  }
  return null;
}

/**
 * 處理所有的成功與錯誤訊息：
 * - successMessages 為直接含有「測試成功」的行（例如包含 "測試成功" 的訊息）
 * - errorMessages 為包含 "錯誤" 的行，並依照 suite/agent/gameId/errorDetail 聚合統計
 */
function aggregateReport(lines) {
  const successMessages = [];
  // 使用 Map 來依 key 聚合錯誤，key = suite|agent|gameId|errorDetail
  const errorMap = new Map();
  // 用來記錄錯誤的分組順序，以便最後依 test suite 分組顯示
  const suiteOrder = new Map();

  lines.forEach(line => {
    // 先判斷是否為成功訊息（包含 "測試成功"）
    if (line.includes('測試成功')) {
      successMessages.push(line);
    }
    // 判斷是否為錯誤訊息（包含 "錯誤" 或 "HTTP錯誤"）
    if (line.includes('錯誤') && line.includes('HTTP錯誤')) {
      const parsed = parseErrorLine(line);
      if (parsed) {
        const key = `${parsed.suite}|${parsed.agent}|${parsed.gameId}|${parsed.errorDetail}`;
        if (errorMap.has(key)) {
          let existing = errorMap.get(key);
          existing.count++;
          errorMap.set(key, existing);
        } else {
          errorMap.set(key, {
            suite: parsed.suite,
            agent: parsed.agent,
            gameId: parsed.gameId,
            errorDetail: parsed.errorDetail,
            count: 1
          });
        }
        // 記錄該 suite 的順序
        if (!suiteOrder.has(parsed.suite)) {
          suiteOrder.set(parsed.suite, []);
        }
        suiteOrder.get(parsed.suite).push(key);
      } else {
        // 若無法解析，就直接儲存原始錯誤行；可自行決定如何處理未解析失敗訊息
      }
    }
  });

  // 按 suite 分組錯誤結果，去除重複鍵（可能出現多次，但已由 Map 聚合）
  const errorsBySuite = {};
  errorMap.forEach((value, key) => {
    if (!errorsBySuite[value.suite]) {
      errorsBySuite[value.suite] = [];
    }
    errorsBySuite[value.suite].push(value);
  });

  return { successMessages, errorsBySuite };
}

// 建構 Telegram 訊息內容
function buildTelegramMessages(aggregated) {
  let successText = '【成功訊息】\n';
  if (aggregated.successMessages.length > 0) {
    aggregated.successMessages.forEach(msg => {
      successText += msg + '\n';
    });
  } else {
    successText += '無成功訊息\n';
  }

  let errorText = '【錯誤訊息】\n';
  const errorsBySuite = aggregated.errorsBySuite;
  if (Object.keys(errorsBySuite).length === 0) {
    errorText += '無錯誤訊息\n';
  } else {
    // 對每個測試模組依序列出聚合結果
    for (const suite in errorsBySuite) {
      errorText += `${suite} 錯誤：\n`;
      errorsBySuite[suite].forEach(err => {
        let line = `  Agent: ${err.agent}, GameID: ${err.gameId} ${err.errorDetail}`;
        if (err.count > 1) {
          line += ` (共 ${err.count} 個)`;
        }
        errorText += line + '\n';
      });
      errorText += '\n';
    }
  }
  return { successText, errorText };
}

// 主流程：讀取 HTML 報告、解析、聚合，並分別發送 Telegram 訊息
(async () => {
  try {
    const reportPath = './playwright-report/index.html';
    const reportText = readHtmlReport(reportPath);
    if (!reportText) {
      console.error('無法讀取報告內容，跳過 Telegram 發送');
      return;
    }
    const lines = extractLines(reportText);
    // 為了精準，篩選出含有特定關鍵字的行，可依需求調整
    const filteredLines = lines.filter(line => line.includes('測試成功') || (line.includes('錯誤') && line.includes('HTTP錯誤')));
    
    const aggregated = aggregateReport(filteredLines);
    const { successText, errorText } = buildTelegramMessages(aggregated);

    // 發送訊息時若任一塊內容長度過長，可拆分多則訊息發送
    await sendTelegramMessage(successText);
    await sendTelegramMessage(errorText);

  } catch (error) {
    console.error('處理報告並發送 Telegram 訊息時發生錯誤：', error.message);
  }
})();
