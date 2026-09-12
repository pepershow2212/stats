import { isSteamId64 } from "./logic.js";

function userNames(user) {
  if (!user) return [];
  return [...new Set(
    [user.globalName, user.displayName, user.username, user.nickname]
      .map((name) => String(name || "").trim())
      .filter((name) => name && name.length >= 2),
  )];
}

function pickFromRows(rows, label) {
  if (rows.length === 1) return { steamId: rows[0].steam_id, note: null };
  if (rows.length > 1) {
    const list = rows.slice(0, 8).map((row) => `• ${row.name} \`${row.steam_id}\``).join("\n");
    return { steamId: null, note: `${label}\n${list}` };
  }
  return null;
}

function searchNames(store, names) {
  for (const name of names) {
    const picked = pickFromRows(store.findPlayers(name), `Несколько игроков по «${name}»:`);
    if (picked) return picked;
  }
  return null;
}

export function resolveSteamId(store, interaction, raw) {
  const query = String(raw || "").trim();
  if (isSteamId64(query)) return { steamId: query, note: null };

  const mention = interaction.options?.getUser?.("игрок") || interaction.options?.getUser?.("user");
  if (mention) {
    const link = store.linkForDiscord(mention.id);
    if (link) return { steamId: link.steam_id, note: null };
    const byName = searchNames(store, userNames(mention));
    if (byName) return byName;
    return { steamId: null, note: `${mention} нет в базе. Укажи игровой ник.` };
  }

  if (query) {
    const picked = pickFromRows(store.findPlayers(query), `Несколько игроков по «${query}»:`);
    if (picked) return picked;
    return { steamId: null, note: `В базе нет «${query}». Проверь ник в игре.` };
  }

  const link = store.linkForDiscord(interaction.user.id);
  if (link) return { steamId: link.steam_id, note: null };

  const member = interaction.member;
  const names = userNames(member || interaction.user);
  if (member?.displayName) names.unshift(member.displayName);
  const bySelf = searchNames(store, names);
  if (bySelf) return bySelf;

  return {
    steamId: null,
    note: "В базе нет совпадения с твоим Discord-ником. Напиши игровой ник: `/stats ник:…`",
  };
}
