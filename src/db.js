import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  steam_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  cash_peak_best INTEGER NOT NULL DEFAULT 0,
  seconds_played INTEGER NOT NULL DEFAULT 0,
  steam_minutes INTEGER NOT NULL DEFAULT 0,
  vac_banned INTEGER NOT NULL DEFAULT 0,
  community_banned INTEGER NOT NULL DEFAULT 0,
  steam_checked_at INTEGER NOT NULL DEFAULT 0,
  last_faction TEXT NOT NULL DEFAULT '',
  last_server_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  seconds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS match_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  steam_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  faction TEXT NOT NULL DEFAULT '',
  map TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  cash_end INTEGER NOT NULL DEFAULT 0,
  cash_peak INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS discord_links (
  discord_id TEXT PRIMARY KEY,
  steam_id TEXT NOT NULL UNIQUE,
  linked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS panels (
  channel_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  guild_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prize_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  frozen INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prize_board_rows (
  board_id INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  steam_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  seconds_played INTEGER NOT NULL DEFAULT 0,
  cash_peak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, rank),
  FOREIGN KEY (board_id) REFERENCES prize_boards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_players_kills ON players(kills DESC);
CREATE INDEX IF NOT EXISTS idx_players_hours ON players(seconds_played DESC);
CREATE INDEX IF NOT EXISTS idx_match_steam ON match_stats(steam_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_sessions_open ON sessions(server_id, left_at);
CREATE INDEX IF NOT EXISTS idx_prize_boards_created ON prize_boards(created_at DESC);
`;

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return new StatsStore(db);
}

export class StatsStore {
  constructor(db) {
    this.db = db;
    this._upsertPlayer = db.prepare(`
      INSERT INTO players (steam_id, name, first_seen, last_seen, last_faction, last_server_id)
      VALUES (@steamId, @name, @now, @now, @faction, @serverId)
      ON CONFLICT(steam_id) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE players.name END,
        last_seen = excluded.last_seen,
        last_faction = excluded.last_faction,
        last_server_id = excluded.last_server_id
    `);
    this._addTime = db.prepare(`
      UPDATE players SET seconds_played = seconds_played + @seconds WHERE steam_id = @steamId
    `);
    this._openSession = db.prepare(`
      INSERT INTO sessions (steam_id, server_id, joined_at) VALUES (@steamId, @serverId, @at)
    `);
    this._closeSession = db.prepare(`
      UPDATE sessions
      SET left_at = @at, seconds = CAST((@at - joined_at) / 1000 AS INTEGER)
      WHERE id = (
        SELECT id FROM sessions
        WHERE steam_id = @steamId AND server_id = @serverId AND left_at IS NULL
        ORDER BY joined_at DESC LIMIT 1
      )
    `);
    this._insertMatch = db.prepare(`
      INSERT INTO match_stats (
        server_id, steam_id, name, faction, map, mode,
        started_at, ended_at, kills, deaths, cash_end, cash_peak, won
      ) VALUES (
        @serverId, @steamId, @name, @faction, @map, @mode,
        @startedAt, @endedAt, @kills, @deaths, @cashEnd, @cashPeak, @won
      )
    `);
    this._applyMatch = db.prepare(`
      UPDATE players SET
        kills = kills + @kills,
        deaths = deaths + @deaths,
        matches = matches + 1,
        wins = wins + @won,
        cash_peak_best = MAX(cash_peak_best, @cashPeak)
      WHERE steam_id = @steamId
    `);
    this._link = db.prepare(`
      INSERT INTO discord_links (discord_id, steam_id, linked_at)
      VALUES (@discordId, @steamId, @at)
      ON CONFLICT(discord_id) DO UPDATE SET steam_id = excluded.steam_id, linked_at = excluded.linked_at
    `);
    this._unlinkSteam = db.prepare(`DELETE FROM discord_links WHERE steam_id = @steamId`);
    this._unlinkDiscord = db.prepare(`DELETE FROM discord_links WHERE discord_id = @discordId`);
    this._getBySteam = db.prepare(`SELECT * FROM players WHERE steam_id = ?`);
    this._getLinkByDiscord = db.prepare(`SELECT * FROM discord_links WHERE discord_id = ?`);
    this._getLinkBySteam = db.prepare(`SELECT * FROM discord_links WHERE steam_id = ?`);
    this._findName = db.prepare(`
      SELECT * FROM players
      WHERE name = ? COLLATE NOCASE
      ORDER BY last_seen DESC LIMIT 8
    `);
    this._searchName = db.prepare(`
      SELECT * FROM players
      WHERE name LIKE ? COLLATE NOCASE
      ORDER BY last_seen DESC LIMIT 8
    `);
    this._setSteam = db.prepare(`
      UPDATE players SET
        avatar = COALESCE(@avatar, avatar),
        steam_minutes = CASE WHEN @steamMinutes >= 0 THEN @steamMinutes ELSE steam_minutes END,
        vac_banned = @vacBanned,
        community_banned = @communityBanned,
        steam_checked_at = @at
      WHERE steam_id = @steamId
    `);
    this._setAvatar = db.prepare(`
      UPDATE players SET
        avatar = CASE WHEN @avatar IS NOT NULL AND @avatar != '' THEN @avatar ELSE avatar END,
        steam_checked_at = @at
      WHERE steam_id = @steamId
    `);
    this._staleSteam = db.prepare(`
      SELECT steam_id FROM players
      WHERE last_seen > @since AND steam_checked_at < @stale
      ORDER BY last_seen DESC LIMIT 80
    `);
    this._getPanel = db.prepare(`SELECT * FROM panels WHERE channel_id = ?`);
    this._allPanels = db.prepare(`SELECT * FROM panels`);
    this._setPanel = db.prepare(`
      INSERT INTO panels (channel_id, message_id, guild_id)
      VALUES (@channelId, @messageId, @guildId)
      ON CONFLICT(channel_id) DO UPDATE SET message_id = excluded.message_id, guild_id = excluded.guild_id
    `);
    this._deletePanel = db.prepare(`DELETE FROM panels WHERE channel_id = ?`);
    this._insertBoard = db.prepare(`
      INSERT INTO prize_boards (reason, created_at, frozen)
      VALUES (@reason, @createdAt, @frozen)
    `);
    this._insertBoardRow = db.prepare(`
      INSERT INTO prize_board_rows (
        board_id, rank, steam_id, name, kills, deaths, wins, matches, seconds_played, cash_peak
      ) VALUES (
        @boardId, @rank, @steamId, @name, @kills, @deaths, @wins, @matches, @secondsPlayed, @cashPeak
      )
    `);
    this._deleteAutoBoards = db.prepare(`
      DELETE FROM prize_boards WHERE reason = 'auto' AND frozen = 0
    `);
    this._latestBoard = db.prepare(`
      SELECT * FROM prize_boards ORDER BY frozen DESC, created_at DESC LIMIT 1
    `);
    this._boardRows = db.prepare(`
      SELECT * FROM prize_board_rows WHERE board_id = ? ORDER BY rank ASC
    `);
    this._favorites = db.prepare(`
      SELECT faction, COUNT(*) AS n, SUM(won) AS wins
      FROM match_stats
      WHERE steam_id = ? AND faction != ''
      GROUP BY faction
      ORDER BY n DESC
    `);
    this._maps = db.prepare(`
      SELECT map, COUNT(*) AS n
      FROM match_stats
      WHERE steam_id = ? AND map != ''
      GROUP BY map
      ORDER BY n DESC
      LIMIT 3
    `);
    this._mates = db.prepare(`
      SELECT p.steam_id, p.name, COUNT(*) AS n
      FROM match_stats a
      JOIN match_stats b
        ON a.server_id = b.server_id
       AND a.started_at = b.started_at
       AND a.steam_id != b.steam_id
      JOIN players p ON p.steam_id = b.steam_id
      WHERE a.steam_id = ?
      GROUP BY b.steam_id
      ORDER BY n DESC
      LIMIT 3
    `);
  }

  touchPlayer(serverId, player, now) {
    this._upsertPlayer.run({
      steamId: player.steamId,
      name: player.name,
      faction: player.faction || "",
      serverId,
      now,
    });
  }

  addSeconds(steamId, seconds) {
    if (seconds <= 0) return;
    this._addTime.run({ steamId, seconds });
  }

  openSession(serverId, steamId, at) {
    this._openSession.run({ serverId, steamId, at });
  }

  closeSession(serverId, steamId, at) {
    this._closeSession.run({ serverId, steamId, at });
  }

  recordMatch(serverId, snapshot, meta) {
    if (!snapshot?.steamId) return;
    const row = {
      serverId,
      steamId: snapshot.steamId,
      name: snapshot.name || "",
      faction: snapshot.faction || "",
      map: meta.map || "",
      mode: meta.mode || "",
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
      kills: snapshot.kills || 0,
      deaths: snapshot.deaths || 0,
      cashEnd: snapshot.cashEnd || 0,
      cashPeak: snapshot.cashPeak || 0,
      won: meta.winners?.includes(snapshot.faction) ? 1 : 0,
    };
    this._insertMatch.run(row);
    this._applyMatch.run(row);
  }

  link(discordId, steamId, at) {
    this._unlinkSteam.run({ steamId });
    this._link.run({ discordId, steamId, at });
  }

  unlinkDiscord(discordId) {
    this._unlinkDiscord.run({ discordId });
  }

  player(steamId) {
    return this._getBySteam.get(steamId) || null;
  }

  linkForDiscord(discordId) {
    return this._getLinkByDiscord.get(discordId) || null;
  }

  extras(steamId) {
    return {
      factions: this._favorites.all(steamId),
      maps: this._maps.all(steamId),
      mates: this._mates.all(steamId),
    };
  }

  findPlayers(query) {
    const q = String(query || "").trim();
    if (!q) return [];
    const exact = this._findName.all(q);
    if (exact.length) return exact;
    return this._searchName.all(`%${q.replaceAll("%", "")}%`);
  }

  suggestPlayers(query) {
    const q = String(query || "").trim().replaceAll("%", "");
    if (!q) {
      return this.db
        .prepare(`SELECT name, steam_id, kills FROM players ORDER BY last_seen DESC LIMIT 25`)
        .all();
    }
    const like = `%${q}%`;
    return this.db
      .prepare(
        `SELECT name, steam_id, kills FROM players
         WHERE name LIKE ? COLLATE NOCASE OR steam_id LIKE ?
         ORDER BY last_seen DESC LIMIT 25`,
      )
      .all(like, like);
  }

  top(metric, limit = 100) {
    const n = Math.min(100, Math.max(1, Number(limit) || 100));
    const board = `
      SELECT p.steam_id, p.name, p.seconds_played, p.cash_peak_best,
             COALESCE(m.kills, 0) AS kills,
             COALESCE(m.deaths, 0) AS deaths,
             COALESCE(m.wins, 0) AS wins,
             COALESCE(m.matches, 0) AS matches
      FROM players p
      LEFT JOIN (
        SELECT steam_id,
               SUM(kills) AS kills,
               SUM(deaths) AS deaths,
               SUM(won) AS wins,
               COUNT(*) AS matches
        FROM match_stats
        GROUP BY steam_id
      ) m ON m.steam_id = p.steam_id
    `;
    const kdExpr = `(CAST(COALESCE(m.kills, 0) AS REAL) / CASE WHEN COALESCE(m.deaths, 0) = 0 THEN 1 ELSE m.deaths END)`;
    const sql = {
      kills: `${board}
        WHERE COALESCE(m.kills, 0) > 0
        ORDER BY kills DESC, ${kdExpr} DESC, p.seconds_played DESC
        LIMIT ${n}`,
      deaths: `${board}
        WHERE COALESCE(m.deaths, 0) > 0
        ORDER BY deaths DESC, kills DESC
        LIMIT ${n}`,
      hours: `${board}
        WHERE p.seconds_played > 0
        ORDER BY p.seconds_played DESC, kills DESC
        LIMIT ${n}`,
      cash: `${board}
        WHERE p.cash_peak_best > 0
        ORDER BY p.cash_peak_best DESC, kills DESC
        LIMIT ${n}`,
      wins: `${board}
        WHERE COALESCE(m.wins, 0) > 0
        ORDER BY wins DESC, matches DESC, kills DESC
        LIMIT ${n}`,
      matches: `${board}
        WHERE COALESCE(m.matches, 0) > 0
        ORDER BY matches DESC, wins DESC, kills DESC
        LIMIT ${n}`,
      kd: `${board}
        WHERE COALESCE(m.matches, 0) >= 3 AND (COALESCE(m.kills, 0) + COALESCE(m.deaths, 0)) >= 8
        ORDER BY ${kdExpr} DESC, kills DESC
        LIMIT ${n}`,
    }[metric];
    if (!sql) return [];
    return this.db.prepare(sql).all();
  }

  saveBoard(rows, { reason = "auto", frozen = 0, at = Date.now() } = {}) {
    const list = rows || [];
    const tx = this.db.transaction((entries) => {
      if (reason === "auto" && !frozen) this._deleteAutoBoards.run();
      const info = this._insertBoard.run({ reason, createdAt: at, frozen: frozen ? 1 : 0 });
      const boardId = Number(info.lastInsertRowid);
      entries.forEach((row, index) => {
        this._insertBoardRow.run({
          boardId,
          rank: index + 1,
          steamId: row.steam_id,
          name: row.name || "",
          kills: row.kills || 0,
          deaths: row.deaths || 0,
          wins: row.wins || 0,
          matches: row.matches || 0,
          secondsPlayed: row.seconds_played || 0,
          cashPeak: row.cash_peak_best || 0,
        });
      });
      return boardId;
    });
    return tx(list);
  }

  latestBoard() {
    const board = this._latestBoard.get();
    if (!board) return null;
    return { ...board, rows: this._boardRows.all(board.id) };
  }

  counts() {
    return this.totals();
  }

  totals() {
    const players = this.db.prepare(`
      SELECT COUNT(*) AS players,
             COALESCE(SUM(matches), 0) AS playerMatches,
             COALESCE(SUM(kills), 0) AS kills
      FROM players
    `).get();
    const games = this.db.prepare(`
      SELECT COUNT(*) AS games FROM (
        SELECT 1 FROM match_stats
        GROUP BY server_id, started_at, map
      )
    `).get();
    return {
      players: players.players || 0,
      playerMatches: players.playerMatches || 0,
      kills: players.kills || 0,
      games: games.games || 0,
    };
  }

  staleSteamIds(now, maxAgeMs = 6 * 60 * 60 * 1000) {
    return this._staleSteam
      .all({ since: now - 48 * 60 * 60 * 1000, stale: now - maxAgeMs })
      .map((row) => row.steam_id);
  }

  updateSteam(steamId, data) {
    this._setSteam.run({
      steamId,
      avatar: data.avatar || null,
      steamMinutes: data.steamMinutes ?? -1,
      vacBanned: data.vacBanned ? 1 : 0,
      communityBanned: data.communityBanned ? 1 : 0,
      at: data.at,
    });
  }

  updateAvatar(steamId, avatar, at) {
    this._setAvatar.run({ steamId, avatar: avatar || null, at });
  }

  panel(channelId) {
    return this._getPanel.get(channelId) || null;
  }

  panels() {
    return this._allPanels.all();
  }

  savePanel(channelId, messageId, guildId) {
    this._setPanel.run({ channelId, messageId, guildId });
  }

  dropPanel(channelId) {
    this._deletePanel.run(channelId);
  }

  close() {
    this.db.close();
  }
}
