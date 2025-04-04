import crypto from 'crypto';

export const ENV_CONFIG = {
  // Prod 環境參數
  login_url: "https://op.qbfqgfgzzgf.com/login",
  // 如果 prod 的 Wcasino URL 與 STG 不同，請依需求修改，這裡保留原值
  expected_Wcasino: "https://www.wcasino9.com/direct/login",
  // 假設 prod 的 galaxsys 啟動 URL 為如下
  expected_galaxsys: "https://launchdigi.net//Games/Launch/",
  // 如果 rectangle 和 playson 在 prod 環境有不同，請依需求修改
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
  // 下注帳號前綴，由環境變數設定，預設為 "QAtest_1120A11"
  accountPrefix: process.env.ACCOUNT_PREFIX || 'QAtest_1120A11',
  keys: {
    "1": "fbe5cce9103974817840c5b53575d6c1",
    "2": "c3bf2511fbd0fc35d5ab2eb989106a92",
    "3": "e474788e8a614823aeb98e15c47b52c0", // prod secret key
  },
};

/**
 * 根據傳入的 agent 與 game_id 產生遊戲 URL。
 * 此函式處理資料組合、計算 API 請求。
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
  
  // 使用 accountPrefix 組合下注帳號
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
  const hashed_data = crypto.createHash('md5')
    .update(data_string + keyUsed, 'utf8')
    .digest('hex');

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
 * 呼叫 Prod 錢包 API 為指定帳號增加餘額
 */
export async function depositMoney(request, account, agent, money) {
  const deposit_url = "https://op.qbfqgfgzzgf.com/doTransferDepositTask";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const orderId = crypto.randomUUID();

  const body = {
    account: account,
    agent: String(agent),
    orderId: orderId,
    money: money,
    timestamp: timestamp,
  };

  const raw = JSON.stringify(body);
  const { agent_switch, keys } = ENV_CONFIG;
  const keyUsed = keys[agent_switch];
  const depositAuth = crypto.createHash('md5')
    .update(raw + keyUsed, 'utf8')
    .digest('hex');

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
