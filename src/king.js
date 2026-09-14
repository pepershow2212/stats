import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AttachmentBuilder, EmbedBuilder, Routes } from "discord.js";
import { config } from "./config.js";
import { addReservedSlot, dropReservedSlot, listReservedSlots } from "./rcon.js";

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

const reserveWarnAt = new Map();
let reserveRetryAt = 0;

function warnReserve(serverName, error) {
  const key = String(serverName || "?");
  const now = Date.now();
  if ((reserveWarnAt.get(key) || 0) + 30 * 60 * 1000 > now) return;
  reserveWarnAt.set(key, now);
  console.warn("reserve", key, error instanceof Error ? error.message : error);
}

async function reserveOnEach(servers, steamId, on) {
  const results = [];
  for (const server of servers || []) {
    try {
      if (on) {
        const want = String(steamId);
        let ids;
        try {
          ids = await listReservedSlots(server);
        } catch (error) {
          warnReserve(server.name, error);
          results.push({ id: server.id, name: server.name, ok: false });
          continue;
        }
        if (ids.includes(want)) {
          results.push({ id: server.id, name: server.name, ok: true });
          continue;
        }
        for (const occupied of ids) {
          if (occupied !== want) await dropReservedSlot(server, occupied).catch(() => {});
        }
        await addReservedSlot(server, steamId);
        const after = await listReservedSlots(server);
        if (!after.includes(want)) throw new Error("слот не записался в RCON");
      } else {
        await dropReservedSlot(server, steamId);
      }
      results.push({ id: server.id, name: server.name, ok: true });
    } catch (error) {
      warnReserve(server.name, error);
      results.push({ id: server.id, name: server.name, ok: false });
    }
  }
  return results;
}

function allServersOk(results) {
  return Boolean(results.length) && results.every((row) => row.ok);
}

async function dropOldKings(store, servers, keepSteamId) {
  const seen = new Set([String(keepSteamId || "")]);
  for (const row of store.allKings()) {
    const steamId = String(row.steam_id || "");
    if (!steamId || seen.has(steamId)) continue;
    seen.add(steamId);
    await reserveOnEach(servers, steamId, false);
  }
}

export async function syncKingReserve(store, servers) {
  const king = store.latestKing();
  if (!king?.steam_id) return;
  if (king.week_key !== kingWeekKey()) return;
  if (king.reserved_ok) return;
  const now = Date.now();
  if (now < reserveRetryAt) return;
  reserveRetryAt = now + 30 * 60 * 1000;
  const reservedOk = allServersOk(await reserveOnEach(servers, king.steam_id, true));
  if (!reservedOk) return;
  store.saveKing({
    weekKey: king.week_key,
    steamId: king.steam_id,
    name: king.name,
    kills: king.kills,
    deaths: king.deaths,
    discordId: king.discord_id,
    crownedAt: king.crowned_at,
    reservedOk: true,
    roleOk: Boolean(king.role_ok),
  });
  console.log(`царь горы: VIP дожал на #1 и #2 для ${king.name}`);
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

async function getGuild(client) {
  if (config.discordGuildId) {
    return client.guilds.fetch(config.discordGuildId).catch(() => null);
  }
  return client.guilds.cache.first() || null;
}

export async function grantKingRoleOnLink(client, store, discordId, steamId) {
  const king = store.latestKing();
  if (!king?.steam_id || king.week_key !== kingWeekKey()) return false;
  if (String(king.steam_id) !== String(steamId)) return false;
  const guild = await getGuild(client);
  const role = guild ? await ensureRole(guild).catch(() => null) : null;
  const roleOk = await setRole(guild, discordId, role, true);
  store.saveKing({
    weekKey: king.week_key,
    steamId: king.steam_id,
    name: king.name,
    kills: king.kills,
    deaths: king.deaths,
    discordId,
    crownedAt: king.crowned_at,
    reservedOk: Boolean(king.reserved_ok),
    roleOk,
  });
  if (roleOk) console.log(`царь горы: роль выдана после /link ${king.name}`);
  return roleOk;
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
  const guild = await getGuild(client);
  const role = guild ? await ensureRole(guild).catch((error) => {
    console.warn("king role create:", error.message);
    return null;
  }) : null;

  if (prev && prev.steam_id !== winner.steam_id && prev.discord_id) {
    await setRole(guild, prev.discord_id, role, false);
  }

  const link = store.linkForSteam(winner.steam_id);
  const roleOk = link?.discord_id ? await setRole(guild, link.discord_id, role, true) : false;
  const row = {
    weekKey,
    steamId: winner.steam_id,
    name: winner.name,
    kills: winner.kills,
    deaths: winner.deaths,
    discordId: link?.discord_id || "",
    crownedAt: Date.now(),
    reservedOk: false,
    roleOk,
  };
  store.saveKing(row);
  console.log(`царь горы: ${winner.name} ${winner.steam_id} · неделя ${weekKey}`);
  await announceKing(client, store, { ...row, mention: link?.discord_id }, prev);

  await dropOldKings(store, servers, winner.steam_id);
  const reservedOk = allServersOk(await reserveOnEach(servers, winner.steam_id, true));
  if (reservedOk) {
    store.saveKing({ ...row, reservedOk: true, roleOk });
    row.reservedOk = true;
  }
  return row;
}

function playerTag(name, discordId) {
  return discordId ? `**${name}** (<@${discordId}>)` : `**${name}**`;
}

function kingIconFile() {
  const path = resolve(config.root, "assets", "king-icon.png");
  if (!existsSync(path)) return [];
  return [new AttachmentBuilder(path, { name: "king-icon.png" })];
}

function kingAnnouncePayload(king, prev) {
  const steamId = king.steamId || king.steam_id;
  const mention = king.mention || king.discordId || king.discord_id || "";
  const winner = playerTag(king.name, mention);
  let story = `${winner} — новый царь горы.`;
  if (prev?.steam_id && prev.steam_id !== steamId) {
    story = `${winner} забрал преимущество у ${playerTag(prev.name, prev.discord_id)}.`;
  } else if (prev?.steam_id && prev.steam_id === steamId) {
    story = `${winner} удержал преимущество ещё на неделю.`;
  }

  const files = kingIconFile();
  const embed = new EmbedBuilder()
    .setColor(0xe8a317)
    .setAuthor({
      name: "ЦАРЬ ГОРЫ",
      ...(files.length ? { iconURL: "attachment://king-icon.png" } : {}),
    })
    .setTitle(king.name || "Царь горы")
    .setDescription(story)
    .addFields(
      { name: "Килы", value: `**${king.kills ?? 0}**`, inline: true },
      { name: "Серверы", value: "**#1** и **#2**", inline: true },
      { name: "SteamID", value: `\`${steamId || "нет"}\``, inline: false },
      {
        name: "VIP",
        value: "Бесплатный VIP — приоритет в очереди на обоих серверах теперь доступен для него.",
        inline: false,
      },
      { name: "До", value: "следующей пятницы **18:00 МСК**", inline: false },
    )
    .setFooter({ text: "WARDOGS RUSSIA" })
    .setTimestamp(king.crownedAt || king.crowned_at || Date.now());

  if (files.length) embed.setThumbnail("attachment://king-icon.png");
  if (!mention) {
    embed.addFields({ name: "Роль", value: "Чтобы получить роль, привяжи Steam: `/link`" });
  }

  return {
    content: "@everyone",
    embeds: [embed],
    files,
    allowedMentions: { parse: ["everyone", "users"] },
  };
}

function kingRulesPayload() {
  const files = kingIconFile();
  const embed = new EmbedBuilder()
    .setColor(0xe8a317)
    .setAuthor({
      name: "ЦАРЬ ГОРЫ",
      ...(files.length ? { iconURL: "attachment://king-icon.png" } : {}),
    })
    .setTitle("Как это работает")
    .setDescription(
      [
        "Каждую **пятницу в 18:00 МСК** бот смотрит общий топ по килам на серверах **#1** и **#2**.",
        "Первое место становится царём горы на неделю.",
      ].join("\n\n"),
    )
    .addFields(
      {
        name: "Что получает царь",
        value: [
          "• роль **Царь горы**",
          "• бесплатный VIP — приоритет в очереди на **#1** и **#2**",
          "• забирает преимущество у прошлого царя",
        ].join("\n"),
      },
      {
        name: "Если игрока нет в Discord",
        value: "VIP всё равно его. Роль выдастся после `/link`.",
      },
      {
        name: "Когда меняется",
        value: "В следующую пятницу в **18:00 МСК** корона переходит новому топ-1. У прошлого царя VIP и роль снимаются.",
      },
    )
    .setFooter({ text: "WARDOGS RUSSIA · один царь · VIP-приоритет на #1 и #2" });

  if (files.length) embed.setThumbnail("attachment://king-icon.png");
  return {
    content: "@everyone",
    embeds: [embed],
    files,
    allowedMentions: { parse: ["everyone"] },
  };
}

async function postToKingChannel(client, payload) {
  const id = config.kingChannelId;
  if (!id) {
    console.warn("царь горы: некуда постить — задай KING_CHANNEL_ID");
    return false;
  }
  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn("царь горы: канал оповещений не найден");
    return false;
  }
  try {
    await channel.send(payload);
    return true;
  } catch (error) {
    console.warn("царь горы пост:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function announceKing(client, _store, king, prev) {
  return postToKingChannel(client, kingAnnouncePayload(king, prev));
}

export async function announceCurrentKing(client, store) {
  const king = store.latestKing();
  if (!king) return null;
  const prev = store.allKings().find((row) => row.steam_id !== king.steam_id) || null;
  const link = store.linkForSteam(king.steam_id);
  await announceKing(client, store, { ...king, mention: king.discord_id || link?.discord_id }, prev);
  return king;
}

export async function announceKingRules(client) {
  return postToKingChannel(client, kingRulesPayload());
}

export function startKingLoop(client, store, servers) {
  const tick = async () => {
    try {
      await crownKing(client, store, servers);
      await syncKingReserve(store, servers);
    } catch (error) {
      console.warn("царь горы:", error instanceof Error ? error.message : error);
    }
  };
  void tick();
  setInterval(() => void tick(), 10 * 60 * 1000);
}
