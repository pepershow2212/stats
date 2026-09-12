const SUMMARIES = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";
const BANS = "https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/";
const OWNED = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function fetchSummaries(apiKey, steamIds) {
  const ids = [...new Set(steamIds.filter(Boolean))];
  if (!apiKey || !ids.length) return new Map();
  const map = new Map();
  for (const group of chunk(ids, 100)) {
    const url = new URL(SUMMARIES);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("steamids", group.join(","));
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Steam summaries ${response.status}`);
    const data = await response.json();
    for (const player of data?.response?.players || []) {
      map.set(String(player.steamid), {
        name: player.personaname || "",
        avatar: player.avatarfull || "",
        profileUrl: player.profileurl || "",
        country: player.loccountrycode || "",
      });
    }
  }
  return map;
}

export async function fetchBans(apiKey, steamIds) {
  const ids = [...new Set(steamIds.filter(Boolean))];
  if (!apiKey || !ids.length) return new Map();
  const map = new Map();
  for (const group of chunk(ids, 100)) {
    const url = new URL(BANS);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("steamids", group.join(","));
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Steam bans ${response.status}`);
    const data = await response.json();
    for (const row of data?.players || []) {
      map.set(String(row.SteamId), {
        vacBanned: Boolean(row.VACBanned),
        communityBanned: Boolean(row.CommunityBanned),
      });
    }
  }
  return map;
}

export async function fetchGameMinutes(apiKey, steamId, appId) {
  if (!apiKey || !steamId) return null;
  const url = new URL(OWNED);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamid", steamId);
  url.searchParams.set("include_appinfo", "0");
  url.searchParams.set("include_played_free_games", "1");
  url.searchParams.set("appids_filter[0]", String(appId));
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const data = await response.json();
  const game = (data?.response?.games || []).find((row) => String(row.appid) === String(appId));
  return game ? Number(game.playtime_forever) || 0 : 0;
}

export async function enrichPlayers(store, { apiKey, appId, steamIds, now }) {
  if (!apiKey || !steamIds.length) return;
  const [summaries, bans] = await Promise.all([
    fetchSummaries(apiKey, steamIds),
    fetchBans(apiKey, steamIds),
  ]);
  for (const steamId of steamIds) {
    const summary = summaries.get(steamId) || {};
    const ban = bans.get(steamId) || {};
    let steamMinutes = -1;
    try {
      const minutes = await fetchGameMinutes(apiKey, steamId, appId);
      if (minutes != null) steamMinutes = minutes;
    } catch {
      steamMinutes = -1;
    }
    store.updateSteam(steamId, {
      avatar: summary.avatar || null,
      steamMinutes,
      vacBanned: ban.vacBanned,
      communityBanned: ban.communityBanned,
      at: now,
    });
  }
}
