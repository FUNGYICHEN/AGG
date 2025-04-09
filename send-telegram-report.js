import fs from "fs";
import axios from "axios";

const TELEGRAM_BOT_TOKEN = "7881684321:AAFGknNFikAsRyb1OVaALUby_xPwdRg4Elw";
const TELEGRAM_CHAT_ID = "-4707429750";
const MAX_MESSAGE_LENGTH = 4000; // 安全上限，不直接使用 4096

// 發送 Telegram 訊息（失敗時印出詳細回應）
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
        disable_web_page_preview: true,
      }
    );
  } catch (error) {
    console.error(
      "發送 Telegram 訊息失敗：",
      error.response && error.response.data ? error.response.data : error.message
    );
  }
}

// 將過長訊息分段（以換行作斷點）
function splitMessage(text, maxLength = MAX_MESSAGE_LENGTH) {
  if (text.length <= maxLength) return [text];
  const lines = text.split("\n");
  const chunks = [];
  let currentChunk = "";
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxLength) {
      chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk += currentChunk ? "\n" + line : line;
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  return chunks;
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

// 遞迴遍歷整個 JSON 物件，抽取 success 與 error 訊息（所有含 error.message 與 stdout 內包含“測試成功”的訊息）
function recursiveExtractMessages(obj, messages = { success: [], error: [] }) {
  if (obj && typeof obj === "object") {
    if (obj.error && typeof obj.error.message === "string") {
      const errText = obj.error.message.trim();
      if (errText) {
        errText.split(/\n/).forEach(line => {
          const trimmed = line.trim();
          if (trimmed) messages.error.push(trimmed);
        });
      }
    }
    if (obj.stdout && Array.isArray(obj.stdout)) {
      obj.stdout.forEach(item => {
        const text = (item.text || "").trim();
        if (text && text.includes("測試成功")) {
          messages.success.push(text);
        }
      });
    }
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        recursiveExtractMessages(obj[key], messages);
      }
    }
  } else if (Array.isArray(obj)) {
    obj.forEach(item => recursiveExtractMessages(item, messages));
  }
  return messages;
}

/**
 * 解析單行錯誤訊息：
 * 1. 若有 "Error: <Brand> URL:" 前綴則取出品牌資訊；
 * 2. 接著解析 "Agent: <agent>, GameID: <gameId> <errorDetail>"
 * 3. 將 errorDetail 以 "->" 切分，僅保留前半段作為 errorMain 用來聚合。
 */
function parseErrorLine(line) {
  let brand = "";
  const brandMatch = line.match(/^Error:\s*([^\s]+)\s*URL:\s*/);
  if (brandMatch) {
    brand = brandMatch[1].trim();
    line = line.replace(/^Error:\s*[^\s]+\s*URL:\s*/, "");
  }
  const regex = /Agent:\s*(\d+),\s*GameID:\s*(\d+)\s*(.+)/;
  const match = line.match(regex);
  if (match) {
    let errorDetail = match[3].trim();
    // 只取 "->" 前面的部分作為聚合依據
    const parts = errorDetail.split("->");
    let errorMain = parts[0].trim();
    return {
      brand,
      agent: match[1].trim(),
      gameId: match[2].trim(),
      errorMain, // 用來聚合錯誤的主要部分（忽略 URL）
      fullError: errorDetail // 原始完整錯誤訊息
    };
  }
  return null;
}

// 將錯誤訊息聚合：相同品牌、Agent 與 errorMain 的錯誤會合併，收集所有不同的 gameId
function aggregateErrorMessages(errorMessages) {
  const errorMap = new Map();
  let currentBrand = "";
  errorMessages.forEach(line => {
    // 若有品牌前綴則取出（例如 "Error: Rectangle URL:"）
    const brandMatch = line.match(/^Error:\s*([^\s]+)\s*URL:/);
    if (brandMatch) {
      currentBrand = brandMatch[1].trim();
      line = line.replace(/^Error:\s*[^\s]+\s*URL:\s*/, "");
    }
    const parsed = parseErrorLine(line);
    if (parsed) {
      // 補上 brand 資訊
      if (!parsed.brand && currentBrand) {
        parsed.brand = currentBrand;
      }
      const key = `${parsed.brand}|${parsed.agent}|${parsed.errorMain}`;
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
    } else {
      // 若無法解析，則以原始文字存入
      const key = `raw|${line}`;
      if (errorMap.has(key)) {
        let item = errorMap.get(key);
        item.count++;
        errorMap.set(key, item);
      } else {
        errorMap.set(key, { raw: line, count: 1 });
      }
    }
  });
  const aggregatedErrors = [];
  errorMap.forEach(value => aggregatedErrors.push(value));
  return aggregatedErrors;
}

// 組裝最終要發送的 Telegram 訊息內容，包含成功與聚合後的錯誤訊息
function buildTelegramMessages({ success, error }) {
  const env = process.env.NODE_ENV ? process.env.NODE_ENV.toLowerCase() : "unknown";
  let successText = `【成功訊息】${env}\n`;
  if (success.length > 0) {
    success.forEach(msg => {
      successText += msg + "\n";
    });
  } else {
    successText += "無成功訊息\n";
  }
  let errorText = `【錯誤訊息】${env}\n`;
  if (error.length > 0) {
    const aggregatedErrors = aggregateErrorMessages(error);
    aggregatedErrors.forEach(err => {
      if (err.raw) {
        errorText += `${err.raw} (共 ${err.count} 筆)\n`;
      } else {
        let prefix = "";
        if (env === "prod" && err.brand) {
          prefix = `(${err.brand})`;
        }
        if (err.count === 1) {
          errorText += `${prefix} Agent: ${err.agent}, GameID: ${err.gameId}, ${err.errorMain}\n`;
        } else {
          errorText += `${prefix} Agent: ${err.agent}, GameID: ${err.gameIds.join(", ")}, ${err.errorMain} (共 ${err.count} 筆錯誤)\n`;
        }
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

  const { success, error } = recursiveExtractMessages(reportJson);
  const { successText, errorText } = buildTelegramMessages({ success, error });

  console.log("預計傳送成功訊息:\n", successText);
  console.log("預計傳送錯誤訊息:\n", errorText);

  const successChunks = splitMessage(successText);
  const errorChunks = splitMessage(errorText);

  for (const chunk of successChunks) {
    await sendTelegramMessage(chunk);
  }
  for (const chunk of errorChunks) {
    await sendTelegramMessage(chunk);
  }
})();
