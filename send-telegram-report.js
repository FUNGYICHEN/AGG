import fs from "fs";
import axios from "axios";

// 請確保正式環境不要硬編碼 Token 與 Chat ID，此處僅示範用
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
 * 遞迴遍歷 suites，收集所有成功訊息和錯誤訊息
 * 對每個測試結果：
 *  - 如果 stdout 中包含 "測試成功"，則加入成功訊息。
 *  - 如果 error.message 包含 "HTTP錯誤"，則拆分多行後加入錯誤訊息陣列。
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
                if (result.stdout && result.stdout.length > 0) {
                  result.stdout.forEach((item) => {
                    const text = (item.text || "").trim();
                    if (text && text.includes("測試成功")) {
                      successMessages.push(text);
                    }
                  });
                }
                if (result.error && result.error.message) {
                  const errText = result.error.message.trim();
                  if (errText && errText.includes("HTTP錯誤")) {
                    const lines = errText
                      .split(/\n/)
                      .map((l) => l.trim())
                      .filter((l) => l.length > 0);
                    errorMessages.push(...lines);
                  }
                }
              });
            }
          });
        }
      });
    }
    if (suite.suites && suite.suites.length > 0) {
      const child = traverseSuites(suite.suites);
      successMessages = successMessages.concat(child.successMessages);
      errorMessages = errorMessages.concat(child.errorMessages);
    }
  });
  return { successMessages, errorMessages };
}

/**
 * 解析單行錯誤訊息，嘗試取得品牌、Agent、GameID 與 HTTP錯誤訊息
 * 假設格式類似：
 * "Error: Rectangle URL: Agent: 10199, GameID: 90001 錯誤: HTTP錯誤：狀態碼 400"
 */
function parseErrorLine(line) {
  let brand = "";
  // 嘗試從行首抓取品牌，格式："Error: <Brand> URL:"
  const brandMatch = line.match(/^Error:\s*([^\s]+)\s*URL:/);
  if (brandMatch) {
    brand = brandMatch[1].trim();
    // 移除前綴部分
    line = line.replace(/^Error:\s*[^\s]+\s*URL:\s*/, "");
  }
  const regex = /Agent:\s*(\d+),\s*GameID:\s*(\d+).*?(HTTP錯誤：狀態碼\s*\d+)/;
  const match = line.match(regex);
  if (match) {
    return {
      brand,
      agent: match[1].trim(),
      gameId: match[2].trim(),
      errorDetail: match[3].trim(),
    };
  }
  return null;
}

/**
 * 聚合錯誤訊息：
 * 根據品牌、Agent 與 HTTP錯誤作為聚合鍵進行合併，
 * 同時收集所有出現的 gameId（若有不同）。
 */
function aggregateErrorMessages(errorMessages) {
  const errorMap = new Map();
  let currentBrand = "";
  errorMessages.forEach((line) => {
    // 如果該行以 "Error:" 開頭，就更新 currentBrand
    const brandMatch = line.match(/^Error:\s*([^\s]+)\s*URL:/);
    if (brandMatch) {
      currentBrand = brandMatch[1].trim();
      line = line.replace(/^Error:\s*[^\s]+\s*URL:\s*/, "");
    }
    const parsed = parseErrorLine(line);
    if (parsed) {
      // 若該行未帶品牌，則沿用 currentBrand
      if (!parsed.brand && currentBrand) {
        parsed.brand = currentBrand;
      }
      // 聚合鍵：品牌 | Agent | HTTP錯誤訊息
      const key = `${parsed.brand}|${parsed.agent}|${parsed.errorDetail}`;
      if (errorMap.has(key)) {
        let item = errorMap.get(key);
        item.count++;
        // 收集不同的 gameId（如果尚未收錄）
        if (!item.gameIds.includes(parsed.gameId)) {
          item.gameIds.push(parsed.gameId);
        }
        errorMap.set(key, item);
      } else {
        errorMap.set(key, { ...parsed, gameIds: [parsed.gameId], count: 1 });
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
 * - 成功訊息與錯誤訊息最上方會顯示運行環境 (prod 或 stg)
 * - 對於錯誤訊息：
 *    * 若 count < 5，則對於單筆（count === 1）只顯示 "Agent: X, HTTP錯誤：狀態碼 YYY"；若有多筆（count 介於 2 至 4），則附加列出所有 gameId
 *    * 若 count >= 5，則僅顯示聚合訊息及總數
 */
function buildTelegramMessages({ successMessages, errorMessages }) {
  const env = process.env.NODE_ENV ? process.env.NODE_ENV.toLowerCase() : "unknown";
  let successText = `【成功訊息】${env}\n`;
  if (successMessages.length > 0) {
    successMessages.forEach((msg) => {
      successText += msg + "\n";
    });
  } else {
    successText += "無成功訊息\n";
  }

  let errorText = `【錯誤訊息】${env}\n`;
  if (errorMessages.length > 0) {
    const aggregatedErrors = aggregateErrorMessages(errorMessages);
    aggregatedErrors.forEach((err) => {
      let prefix = "";
      if (env === "prod" && err.brand) {
        prefix = `(${err.brand})`;
      }
      if (err.count < 5) {
        // 若只有單一筆，則直接顯示不帶 gameID；若多筆 (2~4)，則列出 gameIDs
        if (err.count === 1) {
          errorText += `${prefix}Agent: ${err.agent}, ${err.errorDetail}\n`;
        } else {
          errorText += `${prefix}Agent: ${err.agent}, GameID: ${err.gameIds.join(", ")}, ${err.errorDetail}\n`;
        }
      } else {
        errorText += `${prefix}Agent: ${err.agent}, ${err.errorDetail} (共 ${err.count} 個)\n`;
      }
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