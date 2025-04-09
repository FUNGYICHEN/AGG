import fs from "fs";
import axios from "axios";

const TELEGRAM_BOT_TOKEN = "7881684321:AAFGknNFikAsRyb1OVaALUby_xPwdRg4Elw";
const TELEGRAM_CHAT_ID = "-4707429750";

// 發送 Telegram 訊息
async function sendTelegramMessage(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Telegram 憑證未正確設定！");
    return;
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }
    );
  } catch (error) {
    console.error("發送 Telegram 訊息失敗：", error.message);
  }
}

// 讀取 JSON 報告
function readJsonReport(reportPath) {
  try {
    const data = fs.readFileSync(reportPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("讀取 JSON 報告失敗：", error.message);
    return null;
  }
}

// 遞迴遍歷 suites，收集所有成功與錯誤訊息
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

// 從一行錯誤訊息中解析品牌、Agent、GameID 與 HTTP錯誤資訊
function parseErrorLine(line) {
  let brand = "";
  const brandMatch = line.match(/^Error:\s*([^\s]+)\s*URL:/);
  if (brandMatch) {
    brand = brandMatch[1].trim();
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

// 聚合錯誤訊息：同一品牌、Agent 與 HTTP錯誤視為同一組（收集所有不同的 GameID）
function aggregateErrorMessages(errorMessages) {
  const errorMap = new Map();
  let currentBrand = "";
  errorMessages.forEach((line) => {
    const brandMatch = line.match(/^Error:\s*([^\s]+)\s*URL:/);
    if (brandMatch) {
      currentBrand = brandMatch[1].trim();
      line = line.replace(/^Error:\s*[^\s]+\s*URL:\s*/, "");
    }
    const parsed = parseErrorLine(line);
    if (parsed) {
      if (!parsed.brand && currentBrand) {
        parsed.brand = currentBrand;
      }
      const key = `${parsed.brand}|${parsed.agent}|${parsed.errorDetail}`;
      if (errorMap.has(key)) {
        let item = errorMap.get(key);
        item.count++;
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
  errorMap.forEach((value) => aggregatedErrors.push(value));
  return aggregatedErrors;
}

// 根據成功與錯誤訊息組裝最終要發送的 Telegram 訊息內容
function buildTelegramMessages({ successMessages, errorMessages }) {
  // 使用環境變數 NODE_ENV，若未設定則顯示 unknown
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
      // 若錯誤筆數小於 5，則列出所有 gameId；如果只有單筆則列出單一 gameId
      if (err.count < 5) {
        if (err.count === 1) {
          errorText += `${prefix}Agent: ${err.agent}, GameID: ${err.gameIds[0]}, ${err.errorDetail}\n`;
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
  const reportPath = "./report.json";
  const reportJson = readJsonReport(reportPath);
  if (!reportJson) return;
  const { successMessages, errorMessages } = traverseSuites(reportJson.suites || []);
  const { successText, errorText } = buildTelegramMessages({ successMessages, errorMessages });
  await sendTelegramMessage(successText);
  await sendTelegramMessage(errorText);
})();