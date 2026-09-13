import { Routes } from "discord.js";
import { config } from "./config.js";
import { addReservedSlot, dropReservedSlot } from "./rcon.js";

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function moscowParts(at = Date.now()) {
  const map = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value]),
  );
  return {
    weekday: WEEKDAYS[map.weekday] ?? 0,
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

export function kingWeekKey(at = Date.now()) {
  const part = moscowParts(at);
  const minutes = part.hour * 60 + part.minute;
  let back = (part.weekday - 5 + 7) % 7;
  if (back === 0 && minutes < 18 * 60) back = 7;
  const friday = new Date(Date.UTC(part.year, part.month - 1, part.day) - back * 86400000);
  return `${friday.getUTCFullYear()}-${String(friday.getUTCMonth() + 1).padStart(2, "0")}-${String(friday.getUTCDate()).padStart(2, "0")}`;
}

async function setReserved(servers, steamId, on) {
  let ok = 0;
  for (const server of servers || []) {
    try {
      if (on) await addReservedSlot(server, steamId);
      else await dropReservedSlot(server, steamId);
      ok += 1;
    } catch (error) {
      console.warn("reserve", server.name, error instanceof Error ? error.message : error);
    }
  }
  return ok > 0;
}

async function ensureRole(guild) {
  if (config.kingRoleId) {
    const role = await guild.roles.fetch(config.kingRoleId).catch(() => null);
    if (role) return role;
  }
  let role = guild.roles.cache.find((row) => row.name === config.kingRoleName);
  if (!role) {
    role = await guild.roles.create({
      name: config.kingRoleName,
      color: 0xe8a317,
      mentionable: true,
      reason: "Царь горы",
    });
  }
  return role;
}

async function setRole(guild, discordId, role, on) {
  if (!guild || !discordId || !role) return false;
  try {
    const route = Routes.guildMemberRole(guild.id, discordId, role.id);
    if (on) await guild.client.rest.put(route);
    else await guild.client.rest.delete(route);
    return true;
  } catch (error) {
    console.warn("king role:", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function crownKing(client, store, servers, { force = false } = {}) {
  const weekKey = kingWeekKey();
  if (!force && store.king(weekKey)) return store.king(weekKey);

  const winner = store.top("kills", 1)[0];
  if (!winner?.steam_id) {
    console.log("царь горы: в базе ещё нет топа");
    return null;
  }

  const prev = store.latestKing();
  const guild = config.discordGuildId
    ? await client.guilds.fetch(config.discordGuildId).catch(() => null)
    : client.guilds.cache.first();
  const role = guild ? await ensureRole(guild).catch((error) => {
    console.warn("king role create:", error.message);
    return null;
  }) : null;

  if (prev && prev.steam_id !== winner.steam_id) {
    await setReserved(servers, prev.steam_id, false);
    if (prev.discord_id) await setRole(guild, prev.discord_id, role, false);
  }

  const link = store.linkForSteam(winner.steam_id);
  const reservedOk = await setReserved(servers, winner.steam_id, true);
  const roleOk = link?.discord_id ? await setRole(guild, link.discord_id, role, true) : false;
  const row = {
    weekKey,
    steamId: winner.steam_id,
    name: winner.name,
    kills: winner.kills,
    deaths: winner.deaths,
    discordId: link?.discord_id || "",
    crownedAt: Date.now(),
    reservedOk,
    roleOk,
  };
  store.saveKing(row);
  console.log(`царь горы: ${winner.name} ${winner.steam_id} · неделя ${weekKey}`);
  await announceKing(client, store, { ...row, mention: link?.discord_id });
  return row;
}

async function announceKing(client, store, king) {
  const mention = king.mention ? `<@${king.mention}>` : "привяжи Steam: `/link`";
  const text = [
    "# Царь горы",
    `**${king.name}** — топ-1 недели · **${king.kills}** килов`,
    `Резерв на серверах до следующей пятницы 18:00 МСК`,
    mention,
  ].join("\n");
  const ids = [config.kingChannelId, ...store.panels().map((row) => row.channel_id)].filter(Boolean);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const channel = await client.channels.fetch(id).catch(() => null);
    if (channel?.isTextBased?.()) await channel.send({ content: text }).catch(() => {});
  }
}

export function startKingLoop(client, store, servers) {
  const tick = () => {
    void crownKing(client, store, servers).catch((error) => {
      console.warn("царь горы:", error instanceof Error ? error.message : error);
    });
  };
  tick();
  setInterval(tick, 10 * 60 * 1000);
}
