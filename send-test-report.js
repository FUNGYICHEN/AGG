const fs = require('fs');
const axios = require('axios');

// 從環境變量讀取 Telegram 配置
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function analyzeResults(results) {
  const suites = {};
  
  results.forEach(suite => {
    const suiteName = suite.suite;
    suites[suiteName] = {
      status: suite.specs.every(spec => spec.ok) ? 'passed' : 'failed',
      specs: suite.specs.map(spec => ({
        title: spec.title,
        status: spec.ok ? 'passed' : 'failed',
        errors: spec.tests.flatMap(test => 
          test.results.filter(r => r.status === 'failed').map(r => r.error?.message)
        ).filter(Boolean)
      }))
    };
  });
  
  return {
    startTime: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    suites
  };
}

function generateReport(results) {
  let report = `*測試環境*: ${results.environment.toUpperCase()}\n`;
  report += `*測試時間*: ${new Date(results.startTime).toLocaleString()}\n\n`;
  
  const passedSuites = [];
  const failedSuites = [];
  
  // 分類測試套件
  Object.entries(results.suites).forEach(([name, suite]) => {
    if (suite.status === 'passed') {
      passedSuites.push(name);
    } else {
      const errors = {};
      suite.specs.filter(spec => spec.status === 'failed').forEach(spec => {
        spec.errors.forEach(error => {
          const key = error.split('\n')[0]; // 取第一行作為錯誤摘要
          errors[key] = (errors[key] || 0) + 1;
        });
      });
      failedSuites.push({ name, errors });
    }
  });
  
  // 添加成功訊息
  if (passedSuites.length > 0) {
    report += '*✅ 成功測試*\n';
    report += passedSuites.map(name => `• ${name}`).join('\n') + '\n\n';
  }
  
  // 添加失敗訊息
  if (failedSuites.length > 0) {
    report += '*❌ 失敗測試*\n';
    failedSuites.forEach(suite => {
      report += `*${suite.name}*:\n`;
      Object.entries(suite.errors).forEach(([error, count]) => {
        report += `  - ${error}${count > 1 ? ` (共 ${count} 次)` : ''}\n`;
      });
    });
  }
  
  // 添加摘要
  report += `\n*測試摘要*: ${passedSuites.length} 通過, ${failedSuites.length} 失敗`;
  
  return report;
}

async function sendTelegramMessage(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    console.log('Telegram 通知已發送');
  } catch (error) {
    console.error('發送 Telegram 通知失敗:', error.message);
  }
}

// 主執行函數
(async () => {
  try {
    const rawResults = JSON.parse(fs.readFileSync('test-results.json', 'utf-8'));
    const analyzedResults = analyzeResults(rawResults.suites);
    const report = generateReport(analyzedResults);
    
    console.log(report); // 輸出到 Jenkins 日誌
    
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      await sendTelegramMessage(report);
    } else {
      console.warn('未配置 Telegram 憑證，跳過通知發送');
    }
  } catch (error) {
    console.error('處理測試結果時出錯:', error);
    process.exit(1);
  }
})();