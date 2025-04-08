import fs from 'fs';
import path from 'path';
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const LOG_FILE = path.join(__dirname, 'test.log');

// 讀取 log 檔
async function readLogFile(filePath) {
  return fs.promises.readFile(filePath, 'utf8');
}

// 解析 log 並分組：依品牌記錄成功與錯誤訊息
function parseLog(logText) {
  const lines = logText.split(/\r?\n/);
  const results = {};
  const successRegex = /^(?<brand>\w+)(\s*(?:-|URL))?\s*測試：所有 agent 測試成功，正常取得遊戲 URL/;
  const errorRegex = /^(?:(?<brand>\w+)(?:\s*-\s*)?)?Agent:\s*(?<agent>\d+),\s*GameID:\s*(?<gameid>\d+).*HTTP錯誤：狀態碼\s*(?<status>\d{3}|5XX)/;
  
  for (const line of lines) {
    if (!line.trim()) continue;
    let m = line.match(successRegex);
    if (m) {
      let brand = m.groups.brand || '未知品牌';
      if (!results[brand]) {
        results[brand] = { success: '', errors: {} };
      }
      results[brand].success = line.trim();
      continue;
    }
    m = line.match(errorRegex);
    if (m) {
      let brand = m.groups.brand || '未知品牌';
      if (!results[brand]) {
        results[brand] = { success: '', errors: {} };
      }
      let key = `Agent: ${m.groups.agent}, GameID: ${m.groups.gameid} HTTP錯誤：狀態碼 ${m.groups.status}`;
      if (results[brand].errors[key]) {
        results[brand].errors[key].count++;
      } else {
        results[brand].errors[key] = { text: key, count: 1 };
      }
    }
  }
  return results;
}

// 格式化成功訊息：僅列出成功的品牌訊息
function formatSuccessMessage(results) {
  let msg = "【成功訊息】\n";
  for (let brand in results) {
    if (results[brand].success) {
      msg += results[brand].success + "\n";
    }
  }
  return msg;
}

// 格式化錯誤訊息：若同一錯誤數量 < 5 則逐筆列出，否則聚合顯示
function formatErrorMessage(results) {
  let msg = "【錯誤訊息】\n";
  for (let brand in results) {
    let errors = results[brand].errors;
    if (Object.keys(errors).length > 0) {
      msg += brand + " URL 錯誤：\n";
      for (let key in errors) {
        let err = errors[key];
        if (err.count < 5) {
          for (let i = 0; i < err.count; i++) {
            msg += "  " + err.text + "\n";
          }
        } else {
          msg += "  " + err.text + " (共 " + err.count + " 個)\n";
        }
      }
      msg += "\n";
    }
  }
  return msg;
}

async function main() {
  try {
    const data = await readLogFile(LOG_FILE);
    const results = parseLog(data);
    const successMsg = formatSuccessMessage(results);
    const errorMsg = formatErrorMessage(results);
    console.log(successMsg);
    if (errorMsg.trim() !== "【錯誤訊息】") {
      console.log(errorMsg);
    } else {
      console.log("【錯誤訊息】\n無錯誤");
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

main();