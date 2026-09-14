import { Routes } from "discord.js";
import { config, vipServers } from "./config.js";
import { isSteamId64 } from "./logic.js";
import { addReservedSlot, dropReservedSlot } from "./rcon.js";

const STEAM_RE = /\b(7656119\d{10})\b/;
const DISCORD_RE = /(?:<@!?(\d{17,20})>|discord[:\s#]*(\d{17,20})|\bid[:\s]*(\d{17,20})\b)/i;

export function parseVipMessage(message) {
  const text = String(message || "");
  const steam = text.match(STEAM_RE)?.[1] || "";
  const discord =
    text.match(DISCORD_RE)?.[1] ||
    text.match(DISCORD_RE)?.[2] ||
    text.match(DISCORD_RE)?.[3] ||
    "";
  return { steamId: steam, discordId: discord };
}

export function vipDaysFromAmount(amount, currency = "RUB") {
  const rub = Number(amount) || 0;
  if (String(currency || "RUB").toUpperCase() !== "RUB") return 0;
  const price = config.vipPriceRub;
  if (price <= 0 || rub + 1e-9 < price) return 0;
  const packs = Math.floor(rub / price + 1e-9);
  return packs * config.vipDays;
}

function warn(serverName, error) {
  console.warn("vip reserve", serverName || "?", error instanceof Error ? error.message : error);
}

async function reserveOnVipServers(servers, steamId, on) {
  const list = vipServers(servers);
  const results = [];
  for (const server of list) {
    try {
      if (on) await addReservedSlot(server, steamId, { minSlots: config.vipMaxSlots + 5 });
      else await dropReservedSlot(server, steamId);
      results.push({ id: server.id, name: server.name, ok: true });
    } catch (error) {
      warn(server.name, error);
      results.push({ id: server.id, name: server.name, ok: false });
    }
  }
  return results;
}

function allOk(results) {
  return Boolean(results.length) && results.every((row) => row.ok);
}

async function getGuild(client) {
  if (config.discordGuildId) {
    return client.guilds.fetch(config.discordGuildId).catch(() => null);
  }
  return client.guilds.cache.first() || null;
}

async function ensureVipRole(guild) {
  if (!guild) return null;
  if (config.vipRoleId) {
    const role = await guild.roles.fetch(config.vipRoleId).catch(() => null);
    if (role) return role;
  }
  let role = guild.roles.cache.find((row) => row.name === config.vipRoleName);
  if (!role) {
    role = await guild.roles.create({
      name: config.vipRoleName,
      color: 0xc9a227,
      mentionable: false,
      reason: "Платный VIP",
    });
  }
  return role;
}

async function setVipRole(guild, discordId, role, on) {
  if (!guild || !discordId || !role) return false;
  try {
    const route = Routes.guildMemberRole(guild.id, discordId, role.id);
    if (on) await guild.client.rest.put(route);
    else await guild.client.rest.delete(route);
    return true;
  } catch (error) {
    console.warn("vip role:", error instanceof Error ? error.message : error);
    return false;
  }
}

function isCurrentKing(store, steamId) {
  const king = store.latestKing?.();
  if (!king?.steam_id) return false;
  return String(king.steam_id) === String(steamId);
}

export async function grantVip(client, store, servers, {
  steamId,
  discordId = "",
  name = "",
  source = "manual",
  donationId = null,
  amount = 0,
  currency = "RUB",
  days = config.vipDays,
  note = "",
  extend = true,
} = {}) {
  const id = String(steamId || "");
  if (!isSteamId64(id)) return { ok: false, error: "bad_steam" };

  const now = Date.now();
  const existing = store.activeVip(id, now);
  if (!existing && store.activeVipCount(now) >= config.vipMaxSlots) {
    return { ok: false, error: "full", active: store.activeVipCount(now) };
  }

  const link = store.linkForSteam(id);
  const disc = String(discordId || link?.discord_id || "");
  const player = store.player(id);
  const base = extend && existing?.expires_at > now ? existing.expires_at : now;
  const ms = Math.max(1, Number(days) || config.vipDays) * 86400000;
  const expiresAt = base + ms;
  const startsAt = existing?.starts_at || now;

  store.saveVip({
    steamId: id,
    discordId: disc,
    name: name || player?.name || existing?.name || "",
    source,
    donationId,
    amount,
    currency,
    startsAt,
    expiresAt,
    reservedOk: false,
    roleOk: false,
    note,
  });

  const reservedOk = allOk(await reserveOnVipServers(servers, id, true));
  const guild = client ? await getGuild(client) : null;
  const role = guild ? await ensureVipRole(guild).catch(() => null) : null;
  const roleOk = disc ? await setVipRole(guild, disc, role, true) : false;
  store.markVipFlags(id, { reservedOk, roleOk });

  return {
    ok: true,
    steamId: id,
    discordId: disc,
    expiresAt,
    reservedOk,
    roleOk,
    extended: Boolean(existing),
    days: Math.round((expiresAt - now) / 86400000),
  };
}

export async function revokeVip(client, store, servers, steamId, { keepIfKing = true } = {}) {
  const id = String(steamId || "");
  const row = store.vip(id);
  if (!row) return { ok: false, error: "missing" };

  const king = keepIfKing && isCurrentKing(store, id);
  if (!king) {
    await reserveOnVipServers(servers, id, false);
  }

  const guild = client ? await getGuild(client) : null;
  const role = guild ? await ensureVipRole(guild).catch(() => null) : null;
  if (row.discord_id) await setVipRole(guild, row.discord_id, role, false);

  store.dropVip(id);
  return { ok: true, steamId: id, keptReserveAsKing: Boolean(king) };
}

export async function syncVipReserves(store, servers) {
  const now = Date.now();
  for (const row of store.activeVips(now)) {
    if (row.reserved_ok) continue;
    const reservedOk = allOk(await reserveOnVipServers(servers, row.steam_id, true));
    if (reservedOk) store.markVipFlags(row.steam_id, { reservedOk: true, roleOk: Boolean(row.role_ok) });
  }
}

export async function expireVips(client, store, servers) {
  const now = Date.now();
  let dropped = 0;
  for (const row of store.expiredVipsNeedingDrop(now)) {
    const king = isCurrentKing(store, row.steam_id);
    if (!king) await reserveOnVipServers(servers, row.steam_id, false);
    const guild = client ? await getGuild(client) : null;
    const role = guild ? await ensureVipRole(guild).catch(() => null) : null;
    if (row.discord_id) await setVipRole(guild, row.discord_id, role, false);
    store.markVipFlags(row.steam_id, { reservedOk: false, roleOk: false });
    store.dropVip(row.steam_id);
    dropped += 1;
    console.log(`vip expired ${row.steam_id}${king ? " (слот оставлен — царь горы)" : ""}`);
  }
  return dropped;
}

export async function grantVipRoleOnLink(client, store, discordId, steamId) {
  const vip = store.activeVip(steamId);
  if (!vip) return false;
  store.saveVip({
    steamId: vip.steam_id,
    discordId,
    name: vip.name,
    source: vip.source,
    donationId: vip.donation_id,
    amount: vip.amount,
    currency: vip.currency,
    startsAt: vip.starts_at,
    expiresAt: vip.expires_at,
    reservedOk: Boolean(vip.reserved_ok),
    roleOk: false,
    note: vip.note,
  });
  const guild = await getGuild(client);
  const role = guild ? await ensureVipRole(guild).catch(() => null) : null;
  const roleOk = await setVipRole(guild, discordId, role, true);
  store.markVipFlags(steamId, { reservedOk: Boolean(vip.reserved_ok), roleOk });
  return roleOk;
}

export async function resolveVipTarget(store, { steamId = "", discordId = "", message = "" } = {}) {
  const parsed = parseVipMessage(message);
  const steam = String(steamId || parsed.steamId || "");
  const discord = String(discordId || parsed.discordId || "");
  if (isSteamId64(steam)) {
    const link = store.linkForSteam(steam);
    return { steamId: steam, discordId: discord || link?.discord_id || "", how: "steam" };
  }
  if (discord) {
    const link = store.linkForDiscord(discord);
    if (link?.steam_id) return { steamId: link.steam_id, discordId: discord, how: "discord_link" };
    return { steamId: "", discordId: discord, how: "discord_unlinked" };
  }
  return { steamId: "", discordId: "", how: "none" };
}

export function startVipLoop(client, store, servers) {
  const tick = async () => {
    try {
      await expireVips(client, store, servers);
      await syncVipReserves(store, servers);
    } catch (error) {
      console.warn("vip loop:", error instanceof Error ? error.message : error);
    }
  };
  void tick();
  setInterval(() => void tick(), 10 * 60 * 1000);
}
