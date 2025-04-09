import crypto from "crypto";

// STG 環境的設定
const stgConfig = {
  login_url: "https://stagingop.ggyyonline.com/login",
  expected_Wcasino: "https://tst.wcasino9.com/direct/login",
  expected_galaxsys: "https://partnerapi-gli.stg-digi.com/Games/Launch/",
  expected_Rectangle: "https://g.sandbox.rectangle-games.com",
  expected_Playson: "https://static-stage.rowzone.tech/",
  error_image_prefix: "Content/images/failed/",
  timestamp: "1726734234",
  base_ip: "100.1.2.3",
  app_url: "https://agguatop.ggyyonline.com",
  exit_url: "https://google.com",
  language_type: "zh_cn",
  platform: 0,
  is_direct: true,
  // 固定錢包類型為單一錢包
  agent_switch: "1",
  // 下注帳號前綴（STG 預設）
  accountPrefix: process.env.ACCOUNT_PREFIX || "QAtest_1120A14",
  keys: {
    "1": "fbe5cce9103974817840c5b53575d6c1",
  },
};

// Prod 環境的設定
const prodConfig = {
  login_url: "https://op.qbfqgfgzzgf.com/login",
  expected_Wcasino: "https://www.wcasino9.com/direct/login",
  expected_galaxsys: "https://launchdigi.net//Games/Launch/",
  expected_Rectangle: "https://rc.rg-lgna.com/",
  expected_Playson: "https://launch1-sg-asia.wowgamenew.com/gm/",
  error_image_prefix: "Content/images/failed/",
  timestamp: "1726734234",
  base_ip: "100.1.2.3",
  app_url: "https://agguatop.ggyyonline.com",
  exit_url: "https://google.com",
  language_type: "zh_cn",
  platform: 0,
  is_direct: true,
  // 固定錢包類型為單一錢包
  agent_switch: "3",
  // 下注帳號前綴（Prod 預設）
  accountPrefix: process.env.ACCOUNT_PREFIX || "QAtest_1120A11",
  keys: {
    "1": "fbe5cce9103974817840c5b53575d6c1",
    "2": "c3bf2511fbd0fc35d5ab2eb989106a92",
    "3": "e474788e8a614823aeb98e15c47b52c0", // prod secret key
  },
};

// 根據 NODE_ENV 的值決定使用哪一組設定
export const ENV_CONFIG =
  process.env.NODE_ENV &&
  process.env.NODE_ENV.trim().toLowerCase() === "prod"
    ? prodConfig
    : stgConfig;

/**
 * 根據傳入的 agent 與 game_id 產生遊戲 URL。
 * 此函式負責組合資料、計算認證 (md5) 並呼叫 API。
 */
export async function generateGameUrl(request, agent, game_id) {
  const {
    login_url,
    base_ip,
    timestamp,
    app_url,
    exit_url,
    language_type,
    platform,
    is_direct,
    agent_switch,
    keys,
    accountPrefix,
  } = ENV_CONFIG;

  // 產生下注帳號（依照環境設定不同）
  const ACCOUNT = `${accountPrefix}${agent}${game_id}`;
  const data = {
    account: ACCOUNT,
    agent: String(agent),
    gameId: game_id,
    ip: base_ip,
    timestamp,
    appUrl: app_url,
    exitUrl: exit_url,
    languageType: language_type,
    platform,
    isDirect: is_direct,
  };

  const data_string = JSON.stringify(data);
  const keyUsed = keys[agent_switch];
  const hashed_data = crypto
    .createHash("md5")
    .update(data_string + keyUsed, "utf8")
    .digest("hex");

  const headers = {
    "Authorization": hashed_data,
    "Content-Type": "application/json",
  };

  let response;
  try {
    response = await request.post(login_url, {
      headers,
      data: data_string,
    });
  } catch (e) {
    throw new Error(`API請求錯誤: ${e}`);
  }

  const status = response.status();
  if (status >= 400 && status < 600) {
    throw new Error(`HTTP錯誤：狀態碼 ${status}`);
  }

  let response_json;
  try {
    response_json = await response.json();
  } catch (e) {
    throw new Error(`JSON解析錯誤: ${e}`);
  }

  if (response_json.code !== 0) {
    throw new Error(`API錯誤回應: ${JSON.stringify(response_json)}`);
  }

  const game_url = response_json.data?.url;
  if (!game_url) {
    throw new Error(`API回應中沒有取得 URL，HTTP狀態碼：${status}`);
  }
  return game_url;
}

/**
 * 呼叫錢包 API 為指定帳號增加餘額。
 * 依環境不同，deposit URL 也可能不同
 */
export async function depositMoney(request, account, agent, money) {
  // 根據 NODE_ENV 決定 deposit URL
  const deposit_url =
    process.env.NODE_ENV &&
    process.env.NODE_ENV.trim().toLowerCase() === "prod"
      ? "https://op.qbfqgfgzzgf.com/doTransferDepositTask"
      : "https://stagingop.ggyyonline.com/doTransferDepositTask";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const orderId = crypto.randomUUID();

  const body = {
    account,
    agent: String(agent),
    orderId,
    money,
    timestamp,
  };

  const raw = JSON.stringify(body);
  const { agent_switch, keys } = ENV_CONFIG;
  const keyUsed = keys[agent_switch];
  const depositAuth = crypto
    .createHash("md5")
    .update(raw + keyUsed, "utf8")
    .digest("hex");

  const headers = {
    "Authorization": depositAuth,
    "Content-Type": "application/json",
  };

  const response = await request.post(deposit_url, {
    headers,
    data: raw,
  });

  const result = await response.text();
  console.log("Deposit API 回應：", result);
}
