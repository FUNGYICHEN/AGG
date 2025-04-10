import { test } from '@playwright/test';
import { ENV_CONFIG, generateGameUrl } from './env-config.js';

// 將 NODE_ENV 轉為小寫字串以便後續使用
const env = (process.env.NODE_ENV || 'stg').trim().toLowerCase();
// 共用工具函數
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function executeWithRetry(fn, retries = 2, delay = 300) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < retries) await sleep(delay);
    }
  }
  throw lastError;
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * 各品牌的 agent 清單：
 */

// Rectangle 與 Wcasino：101～172，扣除 138
const baseAgentsRectangle = range(101, 173).filter(num => num !== 138);
const agentsRectangle = baseAgentsRectangle.flatMap(a => [parseInt("10" + a), parseInt("11" + a)]);
// 將 Wcasino 使用相同清單
const agentsWcasino = agentsRectangle;

// Galaxsys：101～172，排除 109, 123, 129, 131, 138, 160, 163, 164, 165, 166
const baseAgentsGalaxsys = range(101, 173).filter(num =>
  ![109, 123, 129, 131, 138, 160, 163, 164, 165, 166].includes(num)
);
const agentsGalaxsys = baseAgentsGalaxsys.flatMap(a => [parseInt("10" + a), parseInt("11" + a)]);

// Playson：根據您提供的明確數列
const baseAgentsPlayson = range(101, 173).filter(num =>
  ![117, 138, 160, 163, 164, 166].includes(num)
);
const agentsPlayson = baseAgentsPlayson.flatMap(a => [parseInt("10" + a), parseInt("11" + a)]);

// 驗證函數
function extractSlugRectangle(url, gameId, mapping) {
  let remainder = url.substring(ENV_CONFIG.expected_Rectangle.length);
  if (remainder.startsWith('/')) remainder = remainder.substring(1);
  const slug = remainder.split('/')[0];
  if (slug !== mapping[gameId]) {
    return `URL 的 GID 不正確 (expected: ${mapping[gameId]}, got: ${slug}) -> ${url}`;
  }
  return null;
}

function validateWcasinoUrl(url, gameId, mapping) {
  try {
    const parsedUrl = new URL(url);
    const actualGid = parsedUrl.searchParams.get('gid');
    if (actualGid !== mapping[gameId]) {
      return `URL 的 gid 不正確 (expected: ${mapping[gameId]}, got: ${actualGid}) -> ${url}`;
    }
  } catch (e) {
    return `URL 解析錯誤: ${e.message} -> ${url}`;
  }
  return null;
}

function validatePlaysonUrl(url, gameId, mapping) {
  try {
    const parsedUrl = new URL(url);
    const gameName = parsedUrl.searchParams.get('gameName');
    if (gameName !== mapping[gameId]) {
      return `URL 的 GID 不正確 (expected: ${mapping[gameId]}, got: ${gameName}) -> ${url}`;
    }
  } catch (e) {
    return `URL 解析錯誤: ${e.message} -> ${url}`;
  }
  return null;
}

function validateGalaxsysUrl(url, gameId, mapping) {
  try {
    const parsedUrl = new URL(url);
    const actualGid = parsedUrl.searchParams.get('gid');
    if (actualGid !== mapping[gameId]) {
      return `URL 的 gid 不正確 (expected: ${mapping[gameId]}, got: ${actualGid}) -> ${url}`;
    }
  } catch (e) {
    return `URL 解析錯誤: ${e.message} -> ${url}`;
  }
  return null;
}

async function validateUrls({ request, agents, gameIds, expectedPrefix, mapping, validateFn, testName, sleepTime = 300, useRetry = false }) {
  let errorMessages = [];
  for (const agent of agents) {
    for (const gameId of gameIds) {
      let game_url;
      try {
        if (useRetry) {
          game_url = await executeWithRetry(() => generateGameUrl(request, agent, gameId), 2, sleepTime);
        } else {
          game_url = await generateGameUrl(request, agent, gameId);
        }
      } catch (e) {
        errorMessages.push(`Agent: ${agent}, GameID: ${gameId} 錯誤: ${e.message || e}`);
        continue;
      }
      if (!game_url.startsWith(expectedPrefix)) {
        errorMessages.push(`Agent: ${agent}, GameID: ${gameId} URL 前綴不符 -> ${game_url}`);
        continue;
      }
      const validationError = validateFn(game_url, gameId, mapping);
      if (validationError) errorMessages.push(`Agent: ${agent}, GameID: ${gameId} ${validationError}`);
      await sleep(sleepTime);
    }
  }
  if (errorMessages.length > 0) {
    throw new Error(`${testName}: ${errorMessages.join("\n")}`);
  } else {
    console.log(`${testName} 測試：所有 agent 測試成功，正常取得遊戲 URL`);
  }
}

// 測試區塊
test.describe('Game URL Tests', () => {

  test.only('Rectangle URL', async ({ request }) => {
    test.setTimeout(0);
    const testName = "Rectangle URL";
    const gameIds = range(90001, 90024);
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

    await validateUrls({
      request,
      agents: agentsRectangle,
      gameIds,
      expectedPrefix: ENV_CONFIG.expected_Rectangle,
      mapping: gameIdToSlug,
      validateFn: extractSlugRectangle,
      testName,
      sleepTime: 300,
      useRetry: true
    });
  });


  test('Wcasino URL', async ({ request }) => {
    test.setTimeout(0);
    const testName = "Wcasino URL";
    const gameIds = [
      60001, 60002, 60003, 60004, 60005, 60006, 60007, 60008, 60009,
      60010, 60011, 60012, 60015, 60016, 60017, 60018, 60020, 60021, 60024
    ];
    // 使用與 Rectangle 相同的 agent 清單
    const gameIdToGid = env === 'prod' ? {
      60001: "2993",
      60002: "2994",
      60003: "2995",
      60004: "2996",
      60005: "2997",
      60006: "2998",
      60007: "2999",
      60008: "3031",
      60009: "3000",
      60010: "3002",
      60011: "3017",
      60012: "3018",
      60015: "3023",
      60016: "3024",
      60017: "3025",
      60018: "3027",
      60020: "3028",
      60021: "3029",
      60024: "3054"
    } : {
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

    await validateUrls({
      request,
      agents: agentsWcasino,
      gameIds,
      expectedPrefix: ENV_CONFIG.expected_Wcasino,
      mapping: gameIdToGid,
      validateFn: validateWcasinoUrl,
      testName,
      sleepTime: 500,
      useRetry: false
    });
  });


  test('Playson URL', async ({ request }) => {
    test.setTimeout(0);
    const testName = "Playson URL";
    const gameIds = [
      20051, 20053, 20054, 20055, 20056, 20057, 20058, 20059,
      24062, 24063, 24064, 24065, 24066, 24067, 24068, 24069, 24070
    ];
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
      24070: "3_pots_of_egypt",
      // 如有需要，24077 可自行補上對應值
    };

    await validateUrls({
      request,
      agents: agentsPlayson,
      gameIds,
      expectedPrefix: ENV_CONFIG.expected_Playson,
      mapping: gameIdToSlug,
      validateFn: validatePlaysonUrl,
      testName,
      sleepTime: 500,
      useRetry: false
    });
  });


  test('Galaxsys URL', async ({ request }) => {
    test.setTimeout(0);
    const testName = "Galaxsys URL";
    const gameIds = range(70001, 70037);
    const gameIdToGid = ENV_CONFIG.login_url.includes("op.qbfqgfgzzgf.com") ? {
      70001: "20786",
      70002: "2014",
      70003: "5935",
      70004: "2010",
      70005: "15543",
      70006: "19",
      70007: "15542",
      70008: "10512",
      70009: "6492",
      70010: "5339",
      70011: "5236",
      70012: "11289",
      70013: "27201",
      70014: "32724",
      70015: "34139",
      70016: "34184",
      70017: "32725",
      70018: "34829",
      70019: "34554",
      70020: "35760",
      70021: "35838",
      70022: "36024",
      70023: "35956",
      70024: "32727",
      70025: "37237",
      70026: "37238",
      70027: "38081",
      70028: "37992",
      70029: "39769",
      70030: "39386",
      70031: "42202",
      70032: "37236",
      70033: "41446",
      70034: "45245",
      70035: "42205",
      70036: "47509"
    } : {
      70001: "12034",
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

    await validateUrls({
      request,
      agents: agentsGalaxsys,
      gameIds,
      expectedPrefix: ENV_CONFIG.expected_galaxsys,
      mapping: gameIdToGid,
      validateFn: validateGalaxsysUrl,
      testName,
      sleepTime: 500,
      useRetry: false
    });
  });

});
