import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fetch as undiciFetch } from "undici";
import { config } from "./config.js";
import { grantVip, resolveVipTarget, vipDaysFromAmount, clearVipCapacityCache } from "./vip.js";

const API = "https://api.boosty.to";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function tokenPath() {
  return resolve(dirname(config.databasePath), "boosty-tokens.json");
}

function loadTokens() {
  const saved = existsSync(tokenPath())
    ? (() => {
        try {
          return JSON.parse(readFileSync(tokenPath(), "utf8"));
        } catch {
          return {};
        }
      })()
    : {};
  return {
    accessToken: saved.accessToken || config.boostyAccessToken,
    refreshToken: saved.refreshToken || config.boostyRefreshToken,
    deviceId: saved.deviceId || config.boostyDeviceId,
    expiresAt: Number(saved.expiresAt) || 0,
  };
}

function saveTokens(tokens) {
  mkdirSync(dirname(tokenPath()), { recursive: true });
  writeFileSync(
    tokenPath(),
    JSON.stringify(
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        deviceId: tokens.deviceId,
        expiresAt: tokens.expiresAt || 0,
        updatedAt: Date.now(),
      },
      null,
      2,
    ),
  );
}

async function refreshTokens(tokens) {
  if (!tokens.refreshToken || !tokens.deviceId) {
    throw new Error("нет BOOSTY_REFRESH_TOKEN / BOOSTY_DEVICE_ID");
  }
  const body = new URLSearchParams({
    device_id: tokens.deviceId,
    device_os: "web",
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  const response = await undiciFetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      origin: "https://boosty.to",
      referer: `https://boosty.to/${config.boostyBlog}`,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Boosty refresh ${response.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  const next = {
    accessToken: json.access_token || json.accessToken,
    refreshToken: json.refresh_token || json.refreshToken || tokens.refreshToken,
    deviceId: tokens.deviceId,
    expiresAt: Number(json.expires_at || json.expiresAt) || Date.now() + Number(json.expires_in || 3600) * 1000,
  };
  if (!next.accessToken) throw new Error("Boosty refresh: нет access_token");
  saveTokens(next);
  console.log("boosty: access token обновлён");
  return next;
}

async function boostyRequest(path, { method = "GET", params, form } = {}) {
  let tokens = loadTokens();
  if (!tokens.accessToken && tokens.refreshToken) {
    tokens = await refreshTokens(tokens);
  }
  if (!tokens.accessToken) throw new Error("нет BOOSTY_ACCESS_TOKEN");

  if (tokens.expiresAt && tokens.expiresAt < Date.now() + 60_000 && tokens.refreshToken) {
    tokens = await refreshTokens(tokens);
  }

  const url = new URL(path.startsWith("http") ? path : `${API}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }

  const headers = {
    authorization: `Bearer ${tokens.accessToken}`,
    "user-agent": UA,
    accept: "application/json, text/plain, */*",
    origin: "https://boosty.to",
    referer: `https://boosty.to/${config.boostyBlog}`,
  };

  let body;
  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    const data = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) {
      if (value != null && value !== "") data.set(key, String(value));
    }
    body = data.toString();
  }

  const doFetch = async (authTokens) =>
    undiciFetch(url, {
      method,
      headers: { ...headers, authorization: `Bearer ${authTokens.accessToken}` },
      body,
      signal: AbortSignal.timeout(20000),
    });

  let response = await doFetch(tokens);
  if (response.status === 401 && tokens.refreshToken) {
    tokens = await refreshTokens(tokens);
    response = await doFetch(tokens);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`Boosty ${response.status} ${method} ${path}: ${text.slice(0, 220)}`);
  return text ? JSON.parse(text) : {};
}

function blockText(data) {
  if (!Array.isArray(data)) return String(data || "");
  return data
    .map((block) => {
      if (typeof block === "string") return block;
      if (!block || typeof block !== "object") return "";
      return block.content || block.modificator === "BLOCK_END" ? block.content || "" : JSON.stringify(block);
    })
    .filter(Boolean)
    .join(" ");
}

function donationText(message) {
  const parts = [
    message?.donation?.message,
    message?.donation?.comment,
    message?.text,
    blockText(message?.data),
    message?.donation ? blockText(message.donation.data) : "",
  ];
  return parts.filter(Boolean).join(" ");
}

function donationAmount(message) {
  const raw =
    message?.donation?.amount ??
    message?.donation?.sum ??
    message?.price ??
    message?.payedAmount ??
    0;
  return Number(raw) || 0;
}

function isDonationMessage(message) {
  if (!message) return false;
  if (message.donation) return true;
  if (message.isPaid && donationAmount(message) > 0) return true;
  return false;
}

async function listRecentDonationMessages() {
  const dialogs = await boostyRequest("/v1/dialog/", { params: { limit: 30 } });
  const rows = Array.isArray(dialogs?.data) ? dialogs.data : [];
  const out = [];

  for (const dialog of rows.slice(0, 20)) {
    const dialogId = dialog.id;
    if (!dialogId) continue;
    const last = dialog.lastMessage;
    if (last && isDonationMessage(last)) {
      out.push({
        id: `boosty_${dialogId}_${last.id}`,
        dialogId,
        messageId: last.id,
        amount: donationAmount(last),
        currency: "RUB",
        message: donationText(last),
        username: dialog.chatmate?.name || dialog.chatmate?.nick || "",
        createdAt: last.createdAt || Date.now(),
      });
    }
    try {
      const page = await boostyRequest(`/v1/dialog/${dialogId}/message/`, { params: { limit: 15 } });
      for (const msg of page?.data || []) {
        if (!isDonationMessage(msg)) continue;
        out.push({
          id: `boosty_${dialogId}_${msg.id}`,
          dialogId,
          messageId: msg.id,
          amount: donationAmount(msg),
          currency: "RUB",
          message: donationText(msg),
          username: dialog.chatmate?.name || dialog.chatmate?.nick || msg.author?.name || "",
          createdAt: msg.createdAt || Date.now(),
        });
      }
    } catch (error) {
      console.warn("boosty messages", dialogId, error instanceof Error ? error.message : error);
    }
  }

  const seen = new Set();
  return out.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

async function announceVip(client, result, donation) {
  const channelId = config.vipChannelId;
  if (!client || !channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const who = result.discordId ? `<@${result.discordId}>` : `\`${result.steamId}\``;
  const until = `<t:${Math.floor(result.expiresAt / 1000)}:d>`;
  await channel
    .send({
      content: `VIP выдан ${who} до ${until} · Boosty ${donation.amount} ₽${result.extended ? " (продление)" : ""}`,
      allowedMentions: { users: result.discordId ? [result.discordId] : [] },
    })
    .catch((error) => console.warn("vip announce:", error.message));
}

export async function processBoostyDonation(client, store, servers, donation) {
  const donationId = String(donation.id);
  const seen = store.donation(donationId);
  if (seen && ["granted", "skipped", "failed", "need_steamid", "need_link"].includes(seen.status)) {
    return null;
  }

  const amount = Number(donation.amount) || 0;
  const message = String(donation.message || "");
  const username = String(donation.username || "");
  const days = vipDaysFromAmount(amount, "RUB");
  const baseRow = {
    donationId,
    username,
    message,
    amount,
    currency: "RUB",
    createdAt: Date.now(),
  };

  if (days <= 0) {
    store.saveDonation({ ...baseRow, status: "skipped", processedAt: Date.now() });
    return { status: "skipped", reason: "amount" };
  }

  const target = resolveVipTarget(store, { message });
  if (!target.steamId) {
    store.saveDonation({
      ...baseRow,
      discordId: target.discordId,
      status: target.how === "discord_unlinked" ? "need_link" : "need_steamid",
      processedAt: Date.now(),
    });
    console.warn(
      `boosty #${donationId}: ${amount} ₽ от ${username || "?"} — нет SteamID в сообщении доната`,
    );
    return { status: "need_steamid", donationId };
  }

  const result = await grantVip(client, store, servers, {
    steamId: target.steamId,
    discordId: target.discordId,
    name: username,
    source: "boosty",
    donationId,
    amount,
    currency: "RUB",
    days,
    note: message.slice(0, 200),
  });

  if (!result.ok) {
    store.saveDonation({
      ...baseRow,
      steamId: target.steamId,
      discordId: target.discordId,
      status: result.error === "full" ? "full" : "failed",
      processedAt: Date.now(),
    });
    return { status: "failed", error: result.error };
  }

  store.saveDonation({
    ...baseRow,
    steamId: result.steamId,
    discordId: result.discordId,
    status: "granted",
    processedAt: Date.now(),
  });
  clearVipCapacityCache();
  console.log(`boosty vip #${donationId}: ${result.steamId} до ${new Date(result.expiresAt).toISOString()}`);
  await announceVip(client, result, { amount });
  try {
    const { refreshVipPanels } = await import("./vip-panel.js");
    await refreshVipPanels(client, store, servers);
  } catch {
    // optional
  }
  return { status: "granted", result };
}

export async function pollBoosty(client, store, servers) {
  const tokens = loadTokens();
  if (!tokens.accessToken && !tokens.refreshToken) return { ok: false, reason: "no_token" };
  const rows = await listRecentDonationMessages();
  let granted = 0;
  let needSteam = 0;
  for (const donation of rows) {
    const out = await processBoostyDonation(client, store, servers, donation);
    if (out?.status === "granted") granted += 1;
    if (out?.status === "need_steamid" || out?.status === "need_link") needSteam += 1;
  }
  return { ok: true, checked: rows.length, granted, needSteam };
}

export function startBoostyLoop(client, store, servers) {
  const tokens = loadTokens();
  if (!tokens.accessToken && !tokens.refreshToken) {
    console.log("boosty: токен не задан — автовыдача VIP выключена (нужны BOOSTY_ACCESS_TOKEN / REFRESH / DEVICE_ID)");
    return;
  }
  const tick = async () => {
    try {
      const out = await pollBoosty(client, store, servers);
      if (out.granted) console.log(`boosty: выдано VIP за тик: ${out.granted}`);
      if (out.needSteam) console.log(`boosty: донаты без SteamID: ${out.needSteam}`);
    } catch (error) {
      console.warn("boosty:", error instanceof Error ? error.message : error);
    }
  };
  void tick();
  setInterval(() => void tick(), config.boostyPollMs);
  console.log(`boosty: поллинг донатов каждые ${Math.round(config.boostyPollMs / 1000)}с · блог ${config.boostyBlog}`);
}
