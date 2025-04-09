const fs = require('fs');
const axios = require('axios');

// 从环境变量获取配置
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 错误分组函数
function groupErrors(errors) {
  const errorMap = new Map();
  
  errors.forEach(error => {
    // 提取关键信息：Agent和GameID
    const match = error.match(/Agent: (\d+), GameID: (\d+).*?(\d{3})/);
    if (match) {
      const key = `${match[1]}-${match[2]}`; // Agent-GameID作为唯一标识
      const statusCode = match[3];
      
      if (errorMap.has(key)) {
        errorMap.get(key).count++;
      } else {
        errorMap.set(key, {
          agent: match[1],
          gameId: match[2],
          statusCode,
          count: 1,
          example: error.replace(/錯誤 \(after retries\):|錯誤:/, '').trim()
        });
      }
    }
  });
  
  return Array.from(errorMap.values());
}

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

// 主函数
(async () => {
  try {
    const results = JSON.parse(fs.readFileSync('test-results.json', 'utf-8'));
    
    // 分析结果
    const report = {
      env: process.env.NODE_ENV || 'development',
      time: new Date().toLocaleString(),
      passed: [],
      failed: []
    };

    // 处理每个测试套件
    results.suites.forEach(suite => {
      suite.specs.forEach(spec => {
        if (spec.ok) {
          // 成功测试
          const passedMsg = spec.tests[0].results[0].stdout.find(s => s.text.includes('測試成功'));
          if (passedMsg) {
            report.passed.push(passedMsg.text.trim());
          }
        } else {
          // 失败测试
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

    // 生成报告文本
    let message = `*[测试报告] ${report.env.toUpperCase()}*\n`;
    message += `⏱ 时间: ${report.time}\n\n`;

    // 成功测试
    if (report.passed.length > 0) {
      message += `✅ *成功测试* (${report.passed.length})\n`;
      message += report.passed.join('\n') + '\n\n';
    }

    // 失败测试
    if (report.failed.length > 0) {
      message += `❌ *失败测试* (${report.failed.length})\n`;
      report.failed.forEach(item => {
        message += `*${item.name}*\n`;
        
        // 按错误类型分组显示
        const errorGroups = {};
        item.errors.forEach(err => {
          const key = `${err.statusCode}`;
          if (!errorGroups[key]) {
            errorGroups[key] = [];
          }
          errorGroups[key].push(err);
        });
        
        Object.entries(errorGroups).forEach(([statusCode, errors]) => {
          message += `  - HTTP ${statusCode} 错误:\n`;
          errors.slice(0, 5).forEach(err => { // 最多显示5个示例
            message += `    • Agent ${err.agent}, Game ${err.gameId}`;
            if (err.count > 1) message += ` (共 ${err.count} 次)`;
            message += '\n';
          });
          if (errors.length > 5) message += `    • ...及其他 ${errors.length - 5} 个\n`;
        });
        message += '\n';
      });
    }

    // 添加摘要
    const totalTests = report.passed.length + report.failed.length;
    message += `📊 *摘要*: ${report.passed.length}/${totalTests} 通过 (${Math.round(report.passed.length/totalTests*100)}%)`;

    console.log('=== 测试报告 ===');
    console.log(message);
    
    // 发送通知
    await sendTelegramMessage(message);
  } catch (error) {
    console.error('处理测试结果时出错:', error);
  }
})();