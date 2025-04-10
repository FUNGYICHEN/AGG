import fs from "fs";
import axios from "axios";

const TELEGRAM_BOT_TOKEN = "7881684321:AAFGknNFikAsRyb1OVaALUby_xPwdRg4Elw";
const TELEGRAM_CHAT_ID = "-4707429750";
const MAX_MESSAGE_LENGTH = 4000; // 安全上限

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

// 分段拆分訊息（以換行斷點）
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
  if (currentChunk) chunks.push(currentChunk);
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

// 遞迴提取 error 與 success 訊息
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
 *   若包含 "Error: <Brand> URL:"，先取得品牌（brand）。
 *   格式例如： 
 *     "Agent: 10173, GameID: 60021, 錯誤: HTTP錯誤：狀態碼 500 -> <url>"
 *   移除前置的 "錯誤:" 字樣，並以 "->" 進行切割，
 *   只保留 "->" 前面的部分作為 errorMain 用以聚合。
 */
function parseErrorLine(line) {
  let brand = "";
  const brandMatch = line.match(/^Error:\s*([^\s]+)\s*URL:\s*/);
  if (brandMatch) {
    brand = brandMatch[1].trim();
    line = line.replace(/^Error:\s*[^\s]+\s*URL:\s*/, "");
  }
  // 注意逗號分隔，errorDetail 可能前面有 ", " 或沒有
  const regex = /Agent:\s*(\d+),\s*GameID:\s*(\d+)(?:,\s*)?(.+)/;
  const match = line.match(regex);
  if (match) {
    let errorDetail = match[3].trim();
    errorDetail = errorDetail.replace(/^錯誤:\s*/, '');
    const parts = errorDetail.split("->");
    let errorMain = parts[0].trim(); // 只取 "->" 前的部分
    return {
      brand,
      agent: match[1].trim(),
      gameId: match[2].trim(),
      errorMain,
      fullError: errorDetail
    };
  }
  return null;
}

/**
 * 聚合同一 agent 下的錯誤：
 *   以 (brand, agent, errorMain) 為 key，收集該 agent 下所有不同 gameId 的錯誤與總次數。
 * 聚合條件：若同一 agent 的該錯誤涉及 5 個以上 gameId，則不列出 gameId清單。
 * 同時以 (brand, gameId, errorMain) 為 key，聚合同一 gameId 在不同 agent 中的錯誤。
 */
function aggregateErrors(errorMessages) {
  const agentMap = new Map(); // agent聚合
  const gameIdMap = new Map(); // gameId聚合

  let currentBrand = "";
  errorMessages.forEach(line => {
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
      const agentKey = `${parsed.brand}|${parsed.agent}|${parsed.errorMain}`;
      if (agentMap.has(agentKey)) {
        const item = agentMap.get(agentKey);
        item.count++;
        if (!item.gameIds.includes(parsed.gameId)) {
          item.gameIds.push(parsed.gameId);
        }
        agentMap.set(agentKey, item);
      } else {
        agentMap.set(agentKey, { ...parsed, gameIds: [parsed.gameId], count: 1 });
      }
      // 同時以 gameId 為 key 聚合
      const gameKey = `${parsed.brand}|${parsed.gameId}|${parsed.errorMain}`;
      if (gameIdMap.has(gameKey)) {
        const item = gameIdMap.get(gameKey);
        item.count++;
        if (!item.agents.includes(parsed.agent)) {
          item.agents.push(parsed.agent);
        }
        gameIdMap.set(gameKey, item);
      } else {
        gameIdMap.set(gameKey, { brand: parsed.brand, gameId: parsed.gameId, errorMain: parsed.errorMain, agents: [parsed.agent], count: 1 });
      }
    } else {
      // 無法解析的直接納入 raw
      const key = `raw|${line}`;
      if (agentMap.has(key)) {
        const item = agentMap.get(key);
        item.count++;
        agentMap.set(key, item);
      } else {
        agentMap.set(key, { raw: line, count: 1 });
      }
    }
  });

  return { agentErrors: Array.from(agentMap.values()), gameIdErrors: Array.from(gameIdMap.values()) };
}

/**
 * 組裝最終要發送的 Telegram 訊息：
 * 1. 成功訊息直接列出（沒有聚合）。
 * 2. 錯誤訊息部分：
 *    - 先列出 agent 聚合結果：若同一 agent 的 gameIds 數量 ≥ 5，則不顯示 gameId。
 *    - 接著若同一 gameId 的錯誤來自 ≥ 5 個 agent，則另外以 gameId 為主列出。
 */
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
    const { agentErrors, gameIdErrors } = aggregateErrors(error);
    // 輸出 agent 聚合結果
    agentErrors.forEach(err => {
      if (err.raw) {
        errorText += `${err.raw} (共 ${err.count} 筆錯誤)\n`;
      } else {
        let prefix = "";
        if (env === "prod" && err.brand) {
          prefix = `(${err.brand}) `;
        }
        if (err.gameIds.length >= 5) {
          errorText += `${prefix}Agent: ${err.agent}, ${err.errorMain} (共 ${err.count} 筆錯誤)\n`;
        } else {
          errorText += `${prefix}Agent: ${err.agent}, GameID: ${err.gameIds.join(", ")}, ${err.errorMain} (共 ${err.count} 筆錯誤)\n`;
        }
      }
    });
    // 輸出 gameId 聚合結果：若同一 gameId 的錯誤來自 ≥ 5 個 agent
    gameIdErrors.forEach(err => {
      if (err.agents.length >= 5) {
        let prefix = "";
        if (env === "prod" && err.brand) {
          prefix = `(${err.brand}) `;
        }
        errorText += `${prefix}GameID: ${err.gameId}, ${err.errorMain} (共 ${err.count} 筆錯誤)\n`;
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