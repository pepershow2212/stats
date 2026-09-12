import { formatHours, formatKd, kd } from "./logic.js";

const RANKS = [
  { name: "Рекрут", hours: 0, tagline: "Первые шаги." },
  { name: "Боец", hours: 2, tagline: "Входим в ритм." },
  { name: "Ветеран", hours: 10, tagline: "Медленно,\nно верно!" },
  { name: "Сержант", hours: 25, tagline: "Держит строй." },
  { name: "Элита", hours: 50, tagline: "Охотится на топ." },
  { name: "Легенда", hours: 100, tagline: "Имя на сервере." },
];

export function rankFromHours(seconds) {
  const hours = Math.max(0, (Number(seconds) || 0) / 3600);
  let current = RANKS[0];
  let next = RANKS[1];
  for (let i = 0; i < RANKS.length; i++) {
    if (hours >= RANKS[i].hours) {
      current = RANKS[i];
      next = RANKS[i + 1] || null;
    }
  }
  const floor = current.hours;
  const ceil = next ? next.hours : floor + 50;
  const progress = next ? Math.min(1, (hours - floor) / Math.max(0.01, ceil - floor)) : 1;
  return {
    name: current.name,
    nextName: next?.name || current.name,
    tagline: current.tagline,
    hours,
    need: ceil,
    have: hours,
    progress,
  };
}

export function liveRow(poller, servers, steamId) {
  for (const server of servers || []) {
    const state = poller?.snapshot(server.id);
    const row = state?.roster?.find((player) => player.steamId === steamId);
    if (!row) continue;
    return {
      server: server.name,
      map: state.status?.map || "",
      kills: row.kills,
      deaths: row.deaths,
      cash: row.cash,
      faction: row.faction,
    };
  }
  return null;
}

export function buildView(store, poller, servers, player) {
  const extra = store.extras(player.steam_id);
  const live = liveRow(poller, servers, player.steam_id);
  const kills = (player.kills || 0) + (live?.kills || 0);
  const deaths = (player.deaths || 0) + (live?.deaths || 0);
  const wins = player.wins || 0;
  const matches = player.matches || 0;
  const games = matches + (live ? 1 : 0);
  const winrate = matches > 0 ? Math.round((wins / matches) * 100) : 0;
  const rank = rankFromHours(player.seconds_played);
  return {
    name: player.name || "Игрок",
    steamId: player.steam_id,
    avatar: player.avatar || "",
    kills,
    deaths,
    kd: formatKd(kills, deaths),
    kdRaw: kd(kills, deaths),
    hours: formatHours(player.seconds_played),
    steamHours: player.steam_minutes > 0 ? formatHours(player.steam_minutes * 60) : "—",
    matches,
    games,
    wins,
    winrate,
    cash: player.cash_peak_best || 0,
    faction: live?.faction || extra.factions[0]?.faction || player.last_faction || "—",
    map: extra.maps[0]?.map || live?.map || "—",
    mates: extra.mates.map((row) => row.name).slice(0, 3),
    live,
    rank,
    vac: Boolean(player.vac_banned),
  };
}
