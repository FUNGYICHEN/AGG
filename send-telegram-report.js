import fs from 'fs';
import axios from 'axios';

// 直接使用硬編碼的 token 與 chat_id（正式環境建議使用環境變數注入方式）
const TELEGRAM_BOT_TOKEN = "7881684321:AAFGknNFikAsRyb1OVaALUby_xPwdRg4Elw";
const TELEGRAM_CHAT_ID = "-4707429750";

/**
 * 發送 Telegram 訊息
 */
async function sendTelegramMessage(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Telegram 憑證未正確設定！");
    return;
  }
  console.log("【Debug】即將發送 Telegram 訊息內容：\n" + message);
  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }
    );
    console.log("【Debug】Telegram 回傳訊息：", response.data);
  } catch (error) {
    console.error("發送 Telegram 訊息失敗：", error.message);
  }
}

/**
 * 讀取 JSON 報告
 */
function readJsonReport(reportPath) {
  try {
    const data = fs.readFileSync(reportPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("讀取 JSON 報告失敗：", error.message);
    return null;
  }
}

/**
 * 遞迴遍歷 suites，收集 stdout 與 error 訊息
 * 如果 error.message 為多行字串，則以換行拆分為多筆
 */
function traverseSuites(suites) {
  let successMessages = [];
  let errorMessages = [];
  suites.forEach((suite) => {
    if (suite.specs && suite.specs.length > 0) {
      suite.specs.forEach((spec) => {
        if (spec.tests && spec.tests.length > 0) {
          spec.tests.forEach((test) => {
            if (test.results && test.results.length > 0) {
              test.results.forEach((result) => {
                // 收集 stdout 中包含 "測試成功" 的訊息
                if (result.stdout && result.stdout.length > 0) {
                  result.stdout.forEach((item) => {
                    const text = (item.text || "").trim();
                    if (text && text.includes("測試成功")) {
                      successMessages.push(text);
                    }
                  });
                }
                // 收集 error.message 中包含 "HTTP錯誤" 的訊息
                if (result.error && result.error.message) {
                  const errText = result.error.message.trim();
                  if (errText && errText.includes("HTTP錯誤")) {
                    // 拆分多行處理
                    const lines = errText.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
                    errorMessages.push(...lines);
                  }
                }
              });
            }
          });
        }
      });
    }
    // 遞迴處理子 suites
    if (suite.suites && suite.suites.length > 0) {
      const child = traverseSuites(suite.suites);
      successMessages = successMessages.concat(child.successMessages);
      errorMessages = errorMessages.concat(child.errorMessages);
    }
  });
  return { successMessages, errorMessages };
}

/**
 * 解析單行錯誤訊息，嘗試抓取品牌、Agent 與 HTTP錯誤訊息
 * 若該行以 "Error:" 開頭，抓取第一個詞作為品牌
 * 例如："Error: Rectangle URL: Agent: 10199, GameID: 90001 錯誤: HTTP錯誤：狀態碼 400"
 */
function parseErrorLine(line) {
  let brand = "";
  // 嘗試捕捉 "Error: <Brand> URL:" 的格式
  const brandMatch = line.match(/^Error:\s*([^\s]+)\s*URL:/);
  if (brandMatch) {
    brand = brandMatch[1].trim();
    // 移除前綴部分
    line = line.replace(/^Error:\s*[^\s]+\s*URL:\s*/, "");
  }
  // 使用 regex 抓取 Agent 與 HTTP錯誤訊息（不考慮 GameID）
  const regex = /Agent:\s*(\d+),\s*GameID:\s*\d+.*?(HTTP錯誤：狀態碼\s*\d+)/;
  const match = line.match(regex);
  if (match) {
    return {
      brand,
      agent: match[1].trim(),
      errorDetail: match[2].trim(),
    };
  }
  return null;
}

/**
 * 將錯誤訊息依據品牌、Agent 與錯誤訊息聚合
 */
function aggregateErrorMessages(errorMessages) {
  const errorMap = new Map();
  // currentBrand 用於記錄前面解析到的品牌（若後續行未帶品牌，則沿用前面的）
  let currentBrand = "";
  errorMessages.forEach((line) => {
    // 檢查是否有品牌前綴
    const brandMatch = line.match(/^Error:\s*([^\s]+)\s*URL:/);
    if (brandMatch) {
      currentBrand = brandMatch[1].trim();
      // 去除前綴部分
      line = line.replace(/^Error:\s*[^\s]+\s*URL:\s*/, "");
    }
    const parsed = parseErrorLine(line);
    if (parsed) {
      // 如果解析後品牌為空，則使用目前記錄的 currentBrand
      if (!parsed.brand && currentBrand) {
        parsed.brand = currentBrand;
      }
      // 聚合依據：品牌, Agent, 與 HTTP錯誤訊息（忽略 GameID）
      const key = `${parsed.brand}|${parsed.agent}|${parsed.errorDetail}`;
      if (errorMap.has(key)) {
        let item = errorMap.get(key);
        item.count++;
        errorMap.set(key, item);
      } else {
        errorMap.set(key, { ...parsed, count: 1 });
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
 * 組裝 Telegram 發送訊息內容
 */
function buildTelegramMessages({ successMessages, errorMessages }) {
  let successText = "【成功訊息】\n";
  if (successMessages.length > 0) {
    successMessages.forEach((msg) => {
      successText += msg + "\n";
    });
  } else {
    successText += "無成功訊息\n";
  }
  let errorText = "【錯誤訊息】\n";
  if (errorMessages.length > 0) {
    const aggregatedErrors = aggregateErrorMessages(errorMessages);
    aggregatedErrors.forEach((err) => {
      let prefix = "";
      if (
        process.env.NODE_ENV &&
        process.env.NODE_ENV.toLowerCase() === "prod" &&
        err.brand
      ) {
        prefix = `(${err.brand})`;
      }
      errorText += `${prefix}Agent: ${err.agent}, ${err.errorDetail}`;
      if (err.count > 1) errorText += ` (共 ${err.count} 個)`;
      errorText += "\n";
    });
  } else {
    errorText += "無錯誤訊息\n";
  }
  return { successText, errorText };
}

(async () => {
  try {
    const reportPath = "./report.json";
    console.log("【Debug】讀取 JSON 報告路徑：" + reportPath);
    const reportJson = readJsonReport(reportPath);
    if (!reportJson) {
      console.error("無法讀取 JSON 報告內容，跳過 Telegram 發送");
      return;
    }
    const { successMessages, errorMessages } = traverseSuites(reportJson.suites || []);
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