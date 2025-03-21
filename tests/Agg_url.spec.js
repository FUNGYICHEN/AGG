import { test } from '@playwright/test';
import { ENV_CONFIG, generateGameUrl } from './api-config.js';

// 輔助函數：延遲指定毫秒數
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 輔助函數：建立數字範圍（包含起始值，不包含結束值）
function range(start, end) {
  return Array.from({ length: end - start }, (_, i) => i + start);
}

test('Rectangle URL', async ({ request }) => {
  test.setTimeout(0);
  const { expected_Rectangle } = ENV_CONFIG;

  // 測試的 game_id 範圍：90001 至 90023（不包含90024）
  const game_ids = range(90001, 90024);

  // 原始 agent 清單，並加上前綴 "10"，例如 101 變成 10101
  const baseAgents = [
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
    111, 112, 113, 114, 115, 116, 117, 118, 119, 120,
    121, 122, 123, 124, 125, 126, 127, 128, 129, 130,
    131, 132, 133, 134, 135, 136, 137, 139, 140, 141,
    142, 143, 144, 145, 146, 147, 148, 149, 150, 151,
    152, 153, 154, 155, 156, 157, 158, 159, 160, 161,
    162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172
  ];
  const agents = baseAgents.map(a => parseInt('10' + a));

  let errorMessages = [];

  for (const agent of agents) {
    for (const game_id of game_ids) {
      try {
        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url.startsWith(expected_Rectangle)) {
          const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 前綴不符 -> ${game_url}`;
          console.error(errMsg);
          errorMessages.push(errMsg);
          continue;
        }
      } catch (e) {
        const errMsg = `Agent: ${agent}, GameID: ${game_id} 錯誤: ${e}`;
        console.error(errMsg);
        errorMessages.push(errMsg);
        continue;
      }
      await sleep(500);
    }
  }

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("Rectangle URL 測試：所有 agent 測試成功，正常取得遊戲 URL");
  }
});


test('Wcasino URL', async ({ request }) => {
  test.setTimeout(0);
  const { expected_Wcasino } = ENV_CONFIG;
  
  // 測試的 game_id 清單
  const game_ids = [
    60001, 60002, 60003, 60004, 60005, 60006, 60007, 60008, 60009, 60010,
    60011, 60012, 60013, 60014, 60015, 60016, 60017, 60018, 60020, 60021,
    60024, 60025
  ];
  
  // 將 base agent 列表，並為每個 base agent 加上前綴 "10" 與 "11"
  const baseAgents = [
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116,
    117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132,
    133, 134, 135, 136, 137, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149,
    150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 161, 162, 164, 165, 167
  ];
  const agents = baseAgents.flatMap(a => [parseInt("10" + a), parseInt("11" + a)]);

  let errorMessages = [];

  for (const agent of agents) {
    for (const game_id of game_ids) {
      try {
        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url.startsWith(expected_Wcasino)) {
          const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 前綴不符 -> ${game_url}`;
          console.error(errMsg);
          errorMessages.push(errMsg);
        }
      } catch (e) {
        let errMsg;
        if (e.message.includes("HTTP錯誤")) {
          errMsg = `Agent: ${agent}, GameID: ${game_id} HTTP狀態碼錯誤: ${e.message}`;
        } else {
          errMsg = `Agent: ${agent}, GameID: ${game_id} 錯誤: ${e}`;
        }
        console.error(errMsg);
        errorMessages.push(errMsg);
      }
      await sleep(500);
    }
  }

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("Wcasino URL 測試：所有 agent 測試成功，正常取得遊戲 URL");
  }
});


test('Playson URL', async ({ request }) => {
  test.setTimeout(0);
  
  const { expected_Playson } = ENV_CONFIG; // ENV_CONFIG 中需定義 expected_Playson
  // 原始 agent 列表，並為每個 agent 加上前綴 "10" 與 "11"
  const baseAgents = [
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
    111, 112, 113, 114, 115, 116, 118, 119, 120, 121,
    122, 123, 124, 125, 126, 127, 128, 129, 130, 131,
    132, 133, 134, 135, 136, 137, 139, 140, 141, 142,
    143, 144, 145, 146, 147, 148, 149, 150, 151, 152,
    153, 154, 155, 156, 157, 158, 159, 161, 162, 165,
    167, 168, 169, 170, 171, 172
  ];
  const agents = baseAgents.flatMap(a => [parseInt("10" + a), parseInt("11" + a)]);
  
  // 指定要測試的 game id 列表：原有 20051~20059，加上 24062~24070
  const gameIds = [
    20051, 20052, 20053, 20054, 20055, 20056, 20057, 20058, 20059,
    24062, 24063, 24064, 24065, 24066, 24067, 24068, 24069, 24070
  ];
  
  let errorMessages = [];
  
  for (const agent of agents) {
    for (const gameId of gameIds) {
      try {
        const url = await generateGameUrl(request, agent, gameId);
        if (!url.startsWith(expected_Playson)) {
          const errMsg = `Agent: ${agent}, GameID: ${gameId} URL 前綴不符 -> ${url}`;
          console.error(errMsg);
          errorMessages.push(errMsg);
        }
      } catch (e) {
        const errMsg = `Agent: ${agent}, GameID: ${gameId} 錯誤: ${e}`;
        console.error(errMsg);
        errorMessages.push(errMsg);
      }
      await sleep(500);
    }
  }
  
  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("Playson URL 測試：所有 agent 測試成功，正常取得遊戲 URL");
  }
});


test('galaxsys URL', async ({ request }) => {
  test.setTimeout(0);
  const { expected_Wcasino } = ENV_CONFIG;
  
  // 測試的 game_id 清單：從 70001 到 70036（包含 70001~70036）
  const game_ids = range(70001, 70037);
  
  // 將 base agent 列表，並為每個 base agent 加上前綴 "10" 與 "11"
  const baseAgents = [
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116,
    117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132,
    133, 134, 135, 136, 137, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149,
    150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 161, 162, 164, 165, 167
  ];
  const agents = baseAgents.flatMap(a => [parseInt("10" + a), parseInt("11" + a)]);

  let errorMessages = [];

  for (const agent of agents) {
    for (const game_id of game_ids) {
      try {
        const game_url = await generateGameUrl(request, agent, game_id);
        if (!game_url.startsWith(expected_Wcasino)) {
          const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 前綴不符 -> ${game_url}`;
          console.error(errMsg);
          errorMessages.push(errMsg);
        }
      } catch (e) {
        let errMsg;
        if (e.message.includes("HTTP錯誤")) {
          errMsg = `Agent: ${agent}, GameID: ${game_id} HTTP狀態碼錯誤: ${e.message}`;
        } else {
          errMsg = `Agent: ${agent}, GameID: ${game_id} 錯誤: ${e}`;
        }
        console.error(errMsg);
        errorMessages.push(errMsg);
      }
      await sleep(500);
    }
  }

  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join("\n"));
  } else {
    console.log("galaxsys URL 測試：所有 agent 測試成功，正常取得遊戲 URL");
  }
});