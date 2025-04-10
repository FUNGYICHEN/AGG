import fs from "fs";
import axios from "axios";

const TELEGRAM_BOT_TOKEN = "7881684321:AAFGknNFikAsRyb1OVaALUby_xPwdRg4Elw";
const TELEGRAM_CHAT_ID = "-4707429750";
const MAX_MESSAGE_LENGTH = 4000; // 安全上限
const GLOBAL_GAMEID_THRESHOLD = 5; // 若同一 gameId 的錯誤來自 >= 5 個 agent，則以 gameId 聚合

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
      error.response && error.response.data
        ? error.response.data
        : error.message
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

// 遞迴遍歷整個 JSON 物件，抽取 success 與 error 訊息
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
 * 若開頭為 "<TestName> URL:"（或帶有 "Error:" 開頭），則先取得測試名稱作為 brand。
 * 接著用正則解析 Agent 與 GameID 與錯誤細節，僅取 "->" 之前的部份作為 errorMain。
 */
function parseErrorLine(line) {
  // 利用正則同時處理可能以 "Error: <TestName> URL:" 或 "<TestName> URL:" 開頭的格式
  let brand = "";
  const brandMatch = line.match(/^(?:Error:\s*)?([^\s]+)\s+URL:\s*/);
  if (brandMatch) {
    brand = brandMatch[1].trim();
    line = line.replace(/^(?:Error:\s*)?[^\s]+\s+URL:\s*/, "");
  }
  const regex = /Agent:\s*(\d+),\s*GameID:\s*(\d+)(?:,\s*)?(.+)/;
  const match = line.match(regex);
  if (match) {
    let errorDetail = match[3].trim();
    errorDetail = errorDetail.replace(/^錯誤:\s*/, '');
    const parts = errorDetail.split("->");
    let errorMain = parts[0].trim();
    return {
      brand: brand || "unknown",
      agent: match[1].trim(),
      gameId: match[2].trim(),
      errorMain,
      fullError: errorDetail
    };
  }
  return null;
}

/**
 * 聚合同一錯誤訊息：
 * agentMap：以 (brand, agent, errorMain) 為 key，聚合同一 agent 的錯誤，收集所有 gameId。
 * gameIdMap：以 (brand, gameId, errorMain) 為 key，聚合同一 gameId 的錯誤跨不同 agent。
 */
function aggregateErrors(errorMessages) {
  const agentMap = new Map(); // 依 agent 聚合
  const gameIdMap = new Map(); // 依 gameId 聚合
  let currentBrand = "";
  errorMessages.forEach(line => {
    // 嘗試從每行開頭提取測試名稱（當作品牌資訊）：
    const brandMatch = line.match(/^(?:Error:\s*)?([^\s]+)\s+URL:\s*/);
    if (brandMatch) {
      currentBrand = brandMatch[1].trim();
      line = line.replace(/^(?:Error:\s*)?[^\s]+\s+URL:\s*/, "");
    }
    const parsed = parseErrorLine(line);
    if (parsed) {
      if (!parsed.brand && currentBrand) {
        parsed.brand = currentBrand;
      }
      // 聚合 agent 層級：key = brand|agent|errorMain
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
      // 聚合 gameId 層級：key = brand|gameId|errorMain
      const gameKey = `${parsed.brand}|${parsed.gameId}|${parsed.errorMain}`;
      if (gameIdMap.has(gameKey)) {
        const item = gameIdMap.get(gameKey);
        item.count++;
        if (!item.agents.includes(parsed.agent)) {
          item.agents.push(parsed.agent);
        }
        gameIdMap.set(gameKey, item);
      } else {
        gameIdMap.set(gameKey, {
          brand: parsed.brand,
          gameId: parsed.gameId,
          errorMain: parsed.errorMain,
          agents: [parsed.agent],
          count: 1
        });
      }
    } else {
      // 若無法解析，直接納入 raw 分組
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
 * 組裝最終要發送的 Telegram 訊息內容：
 * 1. 成功訊息部分按原樣輸出。
 * 2. 錯誤訊息部分：
 *    - 先過濾 agent 層級結果：如果該 agent 錯誤涉及的 gameId 中，有的出現於跨 agent 聚合中（即同一 gameId 錯誤在 ≥ GLOBAL_GAMEID_THRESHOLD 個 agent 中出現），則排除這些 gameId；若全部被排除，則不輸出該 agent 層級資訊。
 *    - 再輸出跨 agent 以 gameId 為主的聚合結果（只輸出 agents 數量 ≥ GLOBAL_GAMEID_THRESHOLD 的）。
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
    // 建立集合，記錄跨 agent 聚合中達到門檻的 gameId 錯誤，格式為 "brand|gameId|errorMain"
    const globalGameErrorSet = new Set();
    gameIdErrors.forEach(err => {
      if (err.agents.length >= GLOBAL_GAMEID_THRESHOLD) {
        globalGameErrorSet.add(`${err.brand}|${err.gameId}|${err.errorMain}`);
      }
    });
    
    // 輸出 agent 層級結果，過濾掉屬於 global 聚合的 gameId
    agentErrors.forEach(err => {
      if (err.raw) {
        errorText += `${err.raw} (共 ${err.count} 筆錯誤)\n`;
      } else {
        let prefix = "";
        if (env === "prod" && err.brand) {
          prefix = `(${err.brand}) `;
        }
        // 過濾掉屬於 global 聚合的 gameId
        const filteredGameIds = err.gameIds.filter(gid => {
          return !globalGameErrorSet.has(`${err.brand}|${gid}|${err.errorMain}`);
        });
        if (filteredGameIds.length === 0) {
          // 如果該 agent 的所有 gameId均已被 global 聚合，則不輸出 agent 資訊
          return;
        }
        if (filteredGameIds.length >= 5) {
          errorText += `${prefix}Agent: ${err.agent}, ${err.errorMain} (共 ${err.count} 筆錯誤)\n`;
        } else {
          errorText += `${prefix}Agent: ${err.agent}, GameID: ${filteredGameIds.join(", ")}, ${err.errorMain} (共 ${err.count} 筆錯誤)\n`;
        }
      }
    });
    
    // 輸出 global（跨 agent）以 gameId 為主的聚合結果
    gameIdErrors.forEach(err => {
      if (err.agents.length >= GLOBAL_GAMEID_THRESHOLD) {
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