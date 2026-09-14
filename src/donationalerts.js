import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fetch as undiciFetch } from "undici";
import { config } from "./config.js";
import { grantVip, resolveVipTarget, vipDaysFromAmount } from "./vip.js";

const DA_API = "https://www.donationalerts.com/api/v1";
const DA_TOKEN = "https://www.donationalerts.com/oauth/token";

function tokenPath() {
  return resolve(dirname(config.databasePath), "donationalerts-tokens.json");
}

function loadSavedTokens() {
  const path = tokenPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function saveTokens(tokens) {
  const path = tokenPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(tokens, null, 2));
}

function currentTokens() {
  const saved = loadSavedTokens();
  return {
    accessToken: saved.accessToken || config.daAccessToken,
    refreshToken: saved.refreshToken || config.daRefreshToken,
  };
}

async function refreshAccessToken(tokens) {
  if (!config.daClientId || !config.daClientSecret || !tokens.refreshToken) {
    throw new Error("нет DA_CLIENT_ID/SECRET/REFRESH_TOKEN для обновления токена");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: config.daClientId,
    client_secret: config.daClientSecret,
  });
  const response = await undiciFetch(DA_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`DA refresh ${response.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  const next = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || tokens.refreshToken,
    updatedAt: Date.now(),
  };
  saveTokens(next);
  console.log("donationalerts: access token обновлён");
  return next;
}

async function daGet(path, tokens) {
  const response = await undiciFetch(`${DA_API}${path}`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (response.status === 401) {
    const err = new Error("unauthorized");
    err.code = 401;
    throw err;
  }
  if (!response.ok) throw new Error(`DA ${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function fetchDonations() {
  let tokens = currentTokens();
  if (!tokens.accessToken) return null;
  try {
    return await daGet("/alerts/donations?page=1", tokens);
  } catch (error) {
    if (error.code !== 401) throw error;
    tokens = await refreshAccessToken(tokens);
    return daGet("/alerts/donations?page=1", tokens);
  }
}

async function announceVip(client, result, donation) {
  const channelId = config.vipChannelId;
  if (!client || !channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const who = result.discordId ? `<@${result.discordId}>` : `\`${result.steamId}\``;
  const until = `<t:${Math.floor(result.expiresAt / 1000)}:d>`;
  await channel.send({
    content: `VIP выдан ${who} до ${until} · ${donation.amount} ${donation.currency}${result.extended ? " (продление)" : ""}`,
    allowedMentions: { users: result.discordId ? [result.discordId] : [] },
  }).catch((error) => console.warn("vip announce:", error.message));
}

export async function processDonation(client, store, servers, donation) {
  const donationId = String(donation.id);
  const seen = store.donation(donationId);
  if (seen && (seen.status === "granted" || seen.status === "skipped" || seen.status === "failed")) {
    return null;
  }

  const amount = Number(donation.amount) || 0;
  const currency = String(donation.currency || "RUB").toUpperCase();
  const message = String(donation.message || "");
  const username = String(donation.username || "");
  const days = vipDaysFromAmount(amount, currency);

  const baseRow = {
    donationId,
    username,
    message,
    amount,
    currency,
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
      `vip donat #${donationId}: ${amount} ${currency} от ${username} — нет SteamID в сообщении` +
        (target.discordId ? ` (discord ${target.discordId} без /link)` : ""),
    );
    return { status: "need_steamid", donationId };
  }

  const result = await grantVip(client, store, servers, {
    steamId: target.steamId,
    discordId: target.discordId,
    name: username,
    source: "donationalerts",
    donationId,
    amount,
    currency,
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
    console.warn(`vip donat #${donationId}: не выдал — ${result.error}`);
    return { status: "failed", error: result.error };
  }

  store.saveDonation({
    ...baseRow,
    steamId: result.steamId,
    discordId: result.discordId,
    status: "granted",
    processedAt: Date.now(),
  });
  console.log(`vip donat #${donationId}: ${result.steamId} до ${new Date(result.expiresAt).toISOString()}`);
  await announceVip(client, result, { amount, currency });
  return { status: "granted", result };
}

export async function pollDonationAlerts(client, store, servers) {
  if (!config.daAccessToken && !loadSavedTokens().accessToken) return { ok: false, reason: "no_token" };
  const body = await fetchDonations();
  if (!body) return { ok: false, reason: "no_token" };
  const rows = Array.isArray(body.data) ? body.data : [];
  let granted = 0;
  for (const donation of rows) {
    const out = await processDonation(client, store, servers, donation);
    if (out?.status === "granted") granted += 1;
  }
  return { ok: true, checked: rows.length, granted };
}

export function startDonationAlertsLoop(client, store, servers) {
  if (!config.daAccessToken && !config.daRefreshToken) {
    console.log("donationalerts: токен не задан — автовыдача VIP выключена");
    return;
  }
  const tick = async () => {
    try {
      const out = await pollDonationAlerts(client, store, servers);
      if (out.granted) console.log(`donationalerts: выдано VIP за тик: ${out.granted}`);
    } catch (error) {
      console.warn("donationalerts:", error instanceof Error ? error.message : error);
    }
  };
  void tick();
  setInterval(() => void tick(), config.daPollMs);
  console.log(`donationalerts: поллинг каждые ${Math.round(config.daPollMs / 1000)}с`);
}
