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
  
    // 原始 agent 清單
    const baseAgents = [
      101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
      111, 112, 113, 114, 115, 116, 117, 118, 119, 120,
      121, 122, 123, 124, 125, 126, 127, 128, 129, 130,
      131, 132, 133, 134, 135, 136, 137, 139, 140, 141,
      142, 143, 144, 145, 146, 147, 148, 149, 150, 151,
      152, 153, 154, 155, 156, 157, 158, 159, 160, 161,
      162, 163, 164, 165, 166, 167, 168, 169, 170,
      171, 172
    ];
    // 將 baseAgents 轉換成前綴 "10" 的 agent，如 101 變成 10101
    const agents = baseAgents.map(a => parseInt('10' + a));
  
    // 定義 game_id 與對應 slug 的映射關係
    const gameIdToSlug = {
      90001: "swaggy-caramelo",
      90002: "persian-jewels",
      90003: "lucky-leprechaun-loot",
      90004: "lucky-duck",
      90005: "lucky-snake",
      90006: "lucky-fox",
      90007: "lucky-turtle",
      90008: "disco-fever",
      90009: "magic-circus",
      90010: "the-lone-fireball",
      90011: "solar-pong",
      90012: "aphrodite-heart",
      90013: "mighty-toro",
      90014: "firebird-quest",
      90015: "golden-year",
      90016: "path-of-gods",
      90017: "fiesta-blue",
      90018: "fiesta-green",
      90019: "rudolphs-gift",
      90020: "iron-valor",
      90021: "realm-of-thunder",
      90022: "black-assassin",
      90023: "smash-fury",
      90024: "the-lucky-year"
    };
  
    let errorMessages = [];
  
    // 輔助函數：從 URL 中提取 slug 部分（移除 expected_Rectangle 後的前導斜線）
    function extractSlug(url) {
      let remainder = url.substring(expected_Rectangle.length);
      if (remainder.startsWith('/')) {
        remainder = remainder.substring(1);
      }
      return remainder.split('/')[0];
    }
  
    for (const agent of agents) {
      for (const game_id of game_ids) {
        let game_url;
        try {
          game_url = await generateGameUrl(request, agent, game_id);
        } catch (e) {
          // 如果捕獲到 HTTP錯誤（400 或 500），等待 500 毫秒後重試兩次
          if (e.message.includes("HTTP錯誤")) {
            let success = false;
            for (let attempt = 1; attempt <= 2; attempt++) {
              await sleep(300);
              try {
                game_url = await generateGameUrl(request, agent, game_id);
                success = true;
                break;
              } catch (e2) {
                console.warn(`Agent: ${agent}, GameID: ${game_id} 重試錯誤（嘗試 ${attempt} 次）: ${e2.message}`);
              }
            }
            if (!success) {
              const errMsg = `Agent: ${agent}, GameID: ${game_id} 錯誤 (after retries): ${e.message}`;
              console.error(errMsg);
              errorMessages.push(errMsg);
              await sleep(300);
              continue;
            }
          } else {
            const errMsg = `Agent: ${agent}, GameID: ${game_id} 錯誤: ${e}`;
            console.error(errMsg);
            errorMessages.push(errMsg);
            await sleep(300);
            continue;
          }
        }
  
        // 檢查 URL 是否以 expected_Rectangle 為前綴
        if (!game_url.startsWith(expected_Rectangle)) {
          const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 前綴不符 -> ${game_url}`;
          console.error(errMsg);
          errorMessages.push(errMsg);
          await sleep(300);
          continue;
        }
  
        // 從 URL 中提取 slug 並檢查是否與預期一致
        const extractedSlug = extractSlug(game_url);
        const expectedSlug = gameIdToSlug[game_id];
        if (extractedSlug !== expectedSlug) {
          const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 的 GID 不正確 (expected: ${expectedSlug}, got: ${extractedSlug}) -> ${game_url}`;
          console.error(errMsg);
          errorMessages.push(errMsg);
        }
        
        await sleep(300);
      }
    }
  
    if (errorMessages.length > 0) {
      throw new Error(testName + ": " + errorMessages.join("\n"));
    } else {
      console.log(`${testName} 測試：所有 agent 測試成功，正常取得遊戲 URL`);
    }
      });


  test('Wcasino URL', async ({ request }) => {
    test.setTimeout(0);
    const { expected_Wcasino } = ENV_CONFIG;
    
    // 測試的 game_id 清單
    const game_ids = [
      60001, 60002, 60003, 60004, 60005, 60006, 60007, 60008, 60009, 60010,
      60011, 60012, 60015, 60016, 60017, 60018, 60020, 60021,
      60024
    ];
    
    // 將 base agent 列表，並為每個 base agent 加上前綴 "10" 與 "11"
    const baseAgents = [
      101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 112, 113, 114, 115, 116,
      117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132,
      133, 134, 135, 136, 137, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149,
      150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 161, 162, 164, 
      165, 167
    ];


    const agents = baseAgents.flatMap(a => [parseInt("10" + a), parseInt("11" + a)]);
    
    // 定義 game_id 與對應的 gid 的映射關係
    const gameIdToGid = {
      60001: "3058",
      60002: "3054",
      60003: "3055",
      60004: "3056",
      60005: "3057",
      60006: "3061",
      60007: "3083",
      60008: "3169",
      60009: "3060",
      60010: "3063",
      60011: "3094",
      60012: "3095",
      60015: "3096",
      60016: "3097",
      60017: "3102",
      60018: "3098",
      60020: "3099",
      60021: "3091",
      60024: "3192"
    };
  
    let errorMessages = [];
    
    for (const agent of agents) {
      for (const game_id of game_ids) {
        let game_url;
        try {
          game_url = await generateGameUrl(request, agent, game_id);
        } catch (e) {
          // 這裡不再做重試邏輯（可依需求添加重試）
          let errMsg;
          if (e.message.includes("HTTP錯誤")) {
            errMsg = `Agent: ${agent}, GameID: ${game_id} HTTP狀態碼錯誤: ${e.message}`;
          } else {
            errMsg = `Agent: ${agent}, GameID: ${game_id} 錯誤: ${e}`;
          }
          console.error(errMsg);
          errorMessages.push(errMsg);
          await sleep(500);
          continue;
        }
    
        // 檢查 URL 是否以 expected_Wcasino 為前綴
        if (!game_url.startsWith(expected_Wcasino)) {
          const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 前綴不符 -> ${game_url}`;
          console.error(errMsg);
          errorMessages.push(errMsg);
          await sleep(500);
          continue;
        }
        
        // 解析 URL，並檢查查詢參數 gid 是否正確
        try {
          const parsedUrl = new URL(game_url);
          const actualGid = parsedUrl.searchParams.get('gid');
          const expectedGid = gameIdToGid[game_id];
          if (actualGid !== expectedGid) {
            const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 的 gid 不正確 (expected: ${expectedGid}, got: ${actualGid}) -> ${game_url}`;
            console.error(errMsg);
            errorMessages.push(errMsg);
            await sleep(500);
            continue;
        }
                     

        } catch (parseErr) {
          const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 解析錯誤: ${parseErr} -> ${game_url}`;
          console.error(errMsg);
          errorMessages.push(errMsg);
          await sleep(500);
          continue;
          
        }
        
        await sleep(500);
      }
    }

if (errorMessages.length > 0) {
  throw new Error(testName + ": " + errorMessages.join("\n"));
} else {
  console.log(`${testName} 測試：所有 agent 測試成功，正常取得遊戲 URL`);
}
  });


  test('Playson URL', async ({ request }) => {
    test.setTimeout(0);
    
    const { expected_Playson } = ENV_CONFIG; // ENV_CONFIG 中需定義 expected_Playson，例如 "https://static-stage.rowzone.tech/"
    
    // 原始 agent 列表，並為每個 agent 加上前綴 "10" 與 "11"
    const baseAgents = [
      101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
      111, 112, 113, 114, 115, 116, 117, 118, 119, 120,
      121, 122, 123, 124, 125, 126, 127, 128, 129, 130,
      131, 132, 133, 134, 135, 136, 137, 139, 140, 141,
      142, 143, 144, 145, 146, 147, 148, 149, 150, 151,
      152, 153, 154, 155, 156, 157, 158, 159, 161, 162,
      165, 167, 168, 169, 170,
      171, 172
    ];
    const agents = baseAgents.flatMap(a => [parseInt("10" + a), parseInt("11" + a)]);
    
    // 指定要測試的 game id 列表：原有 20051~20059，加上 24062~24070
    const gameIds = [
      20051, 20053, 20054, 20055, 20056, 20057, 20058, 20059,
      24062, 24063, 24064, 24065, 24066, 24067, 24068, 24069, 24070
    ];
    
    // 定義 game_id 與對應的 GID slug 的映射關係
    const gameIdToSlug = {
      20051: "pls_energy_joker_hold_and_win",
      20053: "pls_thunder_coins_hold_and_win",
      20054: "pls_3_carts_of_gold_hold_and_win",
      20055: "pls_supercharged_clovers_hold_and_win",
      20056: "pls_piggy_power_hit_the_bonus",
      20057: "pls_3_pirate_barrels_hold_and_win",
      20058: "pls_pink_joker_hold_and_win",
      20059: "pls_merry_giftmas_hold_and_win",
      24062: "fishing_bear",
      24063: "lamp_of_wonder",
      24064: "super_sticky_piggy",
      24065: "coin_lightning",
      24066: "sky_coins",
      24067: "super_hot_chilli",
      24068: "lucky_penny",
      24069: "hot_fire_fruits",
      24070: "3_pots_of_egypt"
    };
    
    let errorMessages = [];
    
    // 輔助函數：從 URL 中提取 query 參數 gameName 作為 GID
    function extractSlug(url) {
      try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get("gameName");
      } catch (e) {
        console.error("Playson - 無法解析 URL:", url);
        return "";
      }
    }
    
    for (const agent of agents) {
      for (const gameId of gameIds) {
        try {
          const url = await generateGameUrl(request, agent, gameId);
          if (!url.startsWith(expected_Playson)) {
            const errMsg = `Playson - Agent: ${agent}, GameID: ${gameId} URL 前綴不符 -> ${url}`;
            console.error(errMsg);
            errorMessages.push(errMsg);
            await sleep(500);
            continue;
          }
          // 從 query string 中取得 gameName 作為 GID
          const extractedSlug = extractSlug(url);
          const expectedSlug = gameIdToSlug[gameId];
          if (extractedSlug !== expectedSlug) {
            const errMsg = `Agent: ${agent}, GameID: ${gameId} URL 的 GID 不正確 (expected: ${expectedSlug}, got: ${extractedSlug}) -> ${url}`;
            console.error(errMsg);
            errorMessages.push(errMsg);
            await sleep(500);
            continue;
          }
          
        } catch (e) {
          if (
            (agent % 1000 === 117) &&
            [20051,20053,20054,20055,20056,20057,20058,20059].includes(gameId) &&
            e.message.includes("400")
          ) {
            await sleep(500);
            continue;
          } else {
            const errMsg = `Playson - Agent: ${agent}, GameID: ${gameId} 錯誤: ${e}`;
            console.error(errMsg);
            errorMessages.push(errMsg);
            await sleep(500);
            continue;
          }
        }
        await sleep(500);
      }
    }
    
if (errorMessages.length > 0) {
  throw new Error(testName + ": " + errorMessages.join("\n"));
} else {
  console.log(`${testName} 測試：所有 agent 測試成功，正常取得遊戲 URL`);
}
  });

  


  test.only('galaxsys URL', async ({ request }) => {
    test.setTimeout(0);
    const { expected_galaxsys } = ENV_CONFIG;
    
    // 測試的 game_id 清單：從 70001 到 70036（包含 70001~70036）
    const game_ids = range(70001, 70037);
    
    // 將 base agent 列表，並為每個 base agent 加上前綴 "10" 與 "11"
    const baseAgents = [
    //   101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 112, 113, 114, 115, 116,
    //   117, 118, 119, 120, 121, 122, 124, 125, 126, 127, 128, 130, 132, 133, 134, 
    //   135, 136, 137, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 
      151, 152, 153, 154, 155, 156, 157, 158, 159, 161, 162, 
         165
    ];
    const agents = baseAgents.flatMap(a => [parseInt("10" + a), parseInt("11" + a)]);
    
    // 定義 game_id 與對應的 gid 的映射關係
    const gameIdToGid = {
      70001: "fgtey45",
      70002: "2014",
      70003: "5935",
      70004: "2010",
      70005: "11997",
      70006: "19",
      70007: "11996",
      70008: "8098",
      70009: "6492",
      70010: "5339",
      70011: "5236",
      70012: "8100",
      70013: "12081",
      70014: "12105",
      70015: "12187",
      70016: "12184",
      70017: "12106",
      70018: "12188",
      70019: "12166",
      70020: "12250",
      70021: "12252",
      70022: "12253",
      70023: "12254",
      70024: "12107",
      70025: "12281",
      70026: "12283",
      70027: "12286",
      70028: "12285",
      70029: "12290",
      70030: "12289",
      70031: "12293",
      70032: "12282",
      70033: "12292",
      70034: "12309",
      70035: "12296",
      70036: "12318"
    };
  
    let errorMessages = [];
    
    for (const agent of agents) {
      for (const game_id of game_ids) {
        let game_url;
        try {
          game_url = await generateGameUrl(request, agent, game_id);
        } catch (e) {
          let errMsg;
          if (e.message.includes("HTTP錯誤")) {
            errMsg = `Agent: ${agent}, GameID: ${game_id} HTTP狀態碼錯誤: ${e.message}`;
          } else {
            errMsg = `Agent: ${agent}, GameID: ${game_id} 錯誤: ${e}`;
          }
          console.error(errMsg);
          errorMessages.push(errMsg);
          await sleep(500);
          continue;
        }
    
        // 檢查 URL 是否以 expected_galaxsys 為前綴
        if (!game_url.startsWith(expected_galaxsys)) {
          const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 前綴不符 -> ${game_url}`;
          console.error(errMsg);
          errorMessages.push(errMsg);
          await sleep(500);
          continue;
        }
        
        // 解析 URL，檢查查詢參數 gid 是否正確
        try {
          const parsedUrl = new URL(game_url);
          const actualGid = parsedUrl.searchParams.get('gid');
          const expectedGid = gameIdToGid[game_id];
          if (actualGid !== expectedGid) {
            const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 的 gid 不正確 (expected: ${expectedGid}, got: ${actualGid}) -> ${game_url}`;
            console.error(errMsg);
            errorMessages.push(errMsg);
            await sleep(500);
            continue;
            
          }
        } catch (parseErr) {
          const errMsg = `Agent: ${agent}, GameID: ${game_id} URL 解析錯誤: ${parseErr} -> ${game_url}`;
          console.error(errMsg);
          errorMessages.push(errMsg);
          await sleep(500);
          continue;
        }
        
        
      }
    }
    
   
    
if (errorMessages.length > 0) {
  throw new Error(testName + ": " + errorMessages.join("\n"));
} else {
  console.log(`${testName} 測試：所有 agent 測試成功，正常取得遊戲 URL`);
}
  });
