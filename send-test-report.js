const fs = require('fs');
const axios = require('axios');

// 從環境變數取得設定
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * 分組並統計相同 Agent 與 GameID 的錯誤（依 HTTP 狀態碼分組）
 */
function groupErrors(errors) {
  const errorMap = new Map();
  errors.forEach(error => {
    // 利用正則擷取 Agent、GameID 與 HTTP 狀態碼（3 位數）
    const match = error.match(/Agent:\s*(\d+),\s*GameID:\s*(\d+).*?(\d{3})/);
    if (match) {
      const key = `${match[1]}-${match[2]}`; // 使用 Agent-GameID 作為唯一標識
      const statusCode = match[3];
      if (errorMap.has(key)) {
        errorMap.get(key).count++;
      } else {
        errorMap.set(key, {
          agent: match[1],
          gameId: match[2],
          statusCode,
          count: 1,
          // 移除重試訊息標記，保留關鍵錯誤文字
          example: error.replace(/錯誤 \(after retries\):|錯誤:/, '').trim()
        });
      }
    }
  });
  return Array.from(errorMap.values());
}

/**
 * 發送 Telegram 訊息通知
 */
async function sendTelegramMessage(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Telegram 凭据未配置！');
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error('发送 Telegram 通知失败:', error.message);
  }
}

/**
 * 建構測試報告訊息
 */
function buildReport(report) {
  let message = `*[测试报告] ${report.env.toUpperCase()}*\n`;
  message += `⏱ 时间: ${report.time}\n\n`;

  if (report.passed.length > 0) {
    message += `✅ *成功测试* (${report.passed.length})\n`;
    message += report.passed.join('\n') + '\n\n';
  }

  if (report.failed.length > 0) {
    message += `❌ *失败测试* (${report.failed.length})\n`;
    report.failed.forEach(item => {
      message += `*${item.name}*\n`;
      // 依 HTTP 狀態碼對錯誤分組
      const errorGroups = {};
      item.errors.forEach(err => {
        const key = err.statusCode;
        if (!errorGroups[key]) errorGroups[key] = [];
        errorGroups[key].push(err);
      });
      for (const [statusCode, errors] of Object.entries(errorGroups)) {
        message += `  - HTTP ${statusCode} 错误:\n`;
        errors.slice(0, 5).forEach(err => {
          message += `    • Agent ${err.agent}, Game ${err.gameId}`;
          if (err.count > 1) message += ` (共 ${err.count} 次)`;
          message += '\n';
        });
        if (errors.length > 5) {
          message += `    • ...及其他 ${errors.length - 5} 个\n`;
        }
      }
      message += '\n';
    });
  }

  const totalTests = report.passed.length + report.failed.length;
  message += `📊 *摘要*: ${report.passed.length}/${totalTests} 通过 (${Math.round(report.passed.length / totalTests * 100)}%)`;

  return message;
}

/**
 * 主流程：讀取測試結果、統整報告並發送 Telegram 通知
 */
(async () => {
  try {
    const results = JSON.parse(fs.readFileSync('test-results.json', 'utf-8'));
    const report = {
      env: process.env.NODE_ENV || 'development',
      time: new Date().toLocaleString(),
      passed: [],
      failed: []
    };

    // 處理每個測試套件
    results.suites.forEach(suite => {
      suite.specs.forEach(spec => {
        if (spec.ok) {
          // 若測試成功，尋找包含「測試成功」關鍵字的訊息
          const passedMsg = spec.tests[0].results[0].stdout.find(s => s.text.includes('測試成功'));
          if (passedMsg) report.passed.push(passedMsg.text.trim());
        } else {
          // 收集所有錯誤訊息
          const errors = spec.tests.flatMap(test =>
            test.results.flatMap(result =>
              result.errors.map(err => err.message)
              .concat(result.stderr.map(s => s.text))
            )
          );
          const grouped = groupErrors(errors);
          report.failed.push({
            name: spec.title,
            errors: grouped
          });
        }
      });
    });

    const message = buildReport(report);
    console.log('=== 测试报告 ===');
    console.log(message);
    
    // 發送 Telegram 訊息
    await sendTelegramMessage(message);
  } catch (error) {
    console.error('处理测试结果时出错:', error);
  }
})();
