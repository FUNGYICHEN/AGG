import fs from 'fs';
import axios from 'axios';

// 直接使用硬編碼的 token 與 chat_id（建議正式環境使用環境變數注入）
const TELEGRAM_BOT_TOKEN = "7881684321:AAFGknNFikAsRyb1OVaALUby_xPwdRg4Elw";
const TELEGRAM_CHAT_ID = "-4707429750";

/**
 * 發送 Telegram 訊息
 */
async function sendTelegramMessage(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Telegram 憑證未正確設定！');
    return;
  }
  console.log("【Debug】即將發送 Telegram 訊息內容：\n" + message);
  try {
    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    console.log('【Debug】Telegram 回傳訊息：', response.data);
  } catch (error) {
    console.error('發送 Telegram 訊息失敗：', error.message);
  }
}

/**
 * 從 JSON 檔案中讀取並解析報告資料
 */
function readJsonReport(reportPath) {
  try {
    const data = fs.readFileSync(reportPath, 'utf-8');
    const jsonData = JSON.parse(data);
    return jsonData;
  } catch (error) {
    console.error("讀取 JSON 報告失敗：", error.message);
    return null;
  }
}

/**
 * 從 Playwright JSON 報告中抽取 stdout 訊息。
 * Playwright JSON reporter 結構通常為：
 * { suites: [ { specs: [ { tests: [ { results: [ { stdout: [ { text } ], stderr: [ { text } ] } ] } ] } ] }, ... ],
 *   stats: {...} }
 */
function extractMessagesFromJsonReport(reportJson){
  let successMessages = [];
  let errorMessages = [];
  
  if(reportJson.suites && Array.isArray(reportJson.suites)){
    reportJson.suites.forEach(suite => {
      if(suite.specs && Array.isArray(suite.specs)){
        suite.specs.forEach(spec => {
          if(spec.tests && Array.isArray(spec.tests)){
            spec.tests.forEach(test => {
              if(test.results && Array.isArray(test.results)){
                test.results.forEach(result => {
                  if(result.stdout && Array.isArray(result.stdout)){
                    result.stdout.forEach(item => {
                      if(item.text){
                        const line = item.text.trim();
                        if(line.length > 0){
                          // 根據你用來輸出訊息的關鍵字過濾，例如「測試成功」或「HTTP錯誤」
                          if(line.includes("測試成功")) {
                            successMessages.push(line);
                          } else if(line.includes("HTTP錯誤")) {
                            errorMessages.push(line);
                          }
                        }
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }
    });
  }
  return { successMessages, errorMessages };
}

/**
 * 聚合錯誤訊息：若相同的 agent 與 gameId 重複出現，則合併計數。
 */
function aggregateErrorMessages(errorMessages){
  const errorMap = new Map();
  // 假設錯誤訊息格式類似 "Agent: 10199, GameID: 90001 ... HTTP錯誤：狀態碼 400"
  const regex = /Agent:\s*(\d+),\s*GameID:\s*(\d+).*?(HTTP錯誤：狀態碼\s*\d+)/;
  errorMessages.forEach(line=>{
    const match = line.match(regex);
    if(match){
      const agent = match[1].trim();
      const gameId = match[2].trim();
      const errorDetail = match[3].trim();
      const key = `${agent}|${gameId}|${errorDetail}`;
      if(errorMap.has(key)){
        let item = errorMap.get(key);
        item.count++;
        errorMap.set(key, item);
      } else{
        errorMap.set(key, { agent, gameId, errorDetail, count: 1 });
      }
    }
  });
  let aggregatedErrors = [];
  errorMap.forEach((value) => {
    aggregatedErrors.push(value);
  });
  return aggregatedErrors;
}

/**
 * 組裝要發送的訊息內容
 */
function buildTelegramMessages({ successMessages, errorMessages }) {
  let successText = '【成功訊息】\n';
  if(successMessages.length > 0){
    successMessages.forEach(msg => {
      successText += msg + "\n";
    });
  } else {
    successText += "無成功訊息\n";
  }
  
  let errorText = '【錯誤訊息】\n';
  if(errorMessages.length > 0){
    const aggregatedErrors = aggregateErrorMessages(errorMessages);
    aggregatedErrors.forEach(err => {
      errorText += `Agent: ${err.agent}, GameID: ${err.gameId} ${err.errorDetail}`;
      if(err.count > 1) errorText += ` (共 ${err.count} 個)`;
      errorText += "\n";
    });
  } else {
    errorText += "無錯誤訊息\n";
  }
  return { successText, errorText };
}

(async () => {
  try {
    // 調整路徑到 report.json（根據你的 reporter 設定，這個檔案會出現在專案根目錄）
    const reportPath = "./report.json";
    console.log("【Debug】讀取 JSON 報告路徑：" + reportPath);
    const reportJson = readJsonReport(reportPath);
    if(!reportJson){
      console.error("無法讀取 JSON 報告內容，跳過 Telegram 發送");
      return;
    }
    const { successMessages, errorMessages } = extractMessagesFromJsonReport(reportJson);
    console.log("【Debug】成功訊息數量：" + successMessages.length);
    console.log("【Debug】錯誤訊息數量：" + errorMessages.length);
    
    const { successText, errorText } = buildTelegramMessages({ successMessages, errorMessages });
    console.log("【Debug】組合成功訊息內容：\n" + successText);
    console.log("【Debug】組合錯誤訊息內容：\n" + errorText);
    
    await sendTelegramMessage(successText);
    await sendTelegramMessage(errorText);
    
  } catch (error) {
    console.error("處理 JSON 報告並發送 Telegram 訊息時發生錯誤：", error.message);
  }
})();
