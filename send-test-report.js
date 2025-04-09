const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const FormData = require('form-data');

// 從環境變數取得 Telegram 憑證（Jenkins Credentials 注入）
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

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

function readHtmlReport(reportPath) {
  try {
    const html = fs.readFileSync(reportPath, 'utf-8');
    const $ = cheerio.load(html);
    return $('body').text();
  } catch (error) {
    console.error('讀取 HTML 報告失敗：', error.message);
    return null;
  }
}

function extractLines(reportText) {
  return reportText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
}

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

function aggregateReport(lines) {
  const successMessages = [];
  const errorMap = new Map();

  lines.forEach(line => {
    if (line.includes('測試成功')) {
      successMessages.push(line);
    }
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
      }
    }
  });

  const errorsBySuite = {};
  errorMap.forEach((value) => {
    if (!errorsBySuite[value.suite]) {
      errorsBySuite[value.suite] = [];
    }
    errorsBySuite[value.suite].push(value);
  });

  return { successMessages, errorsBySuite };
}

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

(async () => {
  try {
    const reportPath = './playwright-report/index.html';
    const reportText = readHtmlReport(reportPath);
    if (!reportText) {
      console.error('無法讀取報告內容，跳過 Telegram 發送');
      return;
    }
    const lines = extractLines(reportText);
    // 過濾出包含「測試成功」和「HTTP錯誤」的行
    const filteredLines = lines.filter(line => line.includes('測試成功') || (line.includes('錯誤') && line.includes('HTTP錯誤')));
    
    const aggregated = aggregateReport(filteredLines);
    const { successText, errorText } = buildTelegramMessages(aggregated);

    await sendTelegramMessage(successText);
    await sendTelegramMessage(errorText);

  } catch (error) {
    console.error('處理報告並發送 Telegram 訊息時發生錯誤：', error.message);
  }
})();
