import { persistTop100 } from "./leaderboard.js";
import { applyTick, emptyState } from "./logic.js";
import { fetchSnapshot } from "./rcon.js";
import { enrichAvatars, enrichPlayers } from "./steam.js";

export class Poller {
  constructor({ store, servers, pollMs, steamApiKey, appId, dataDir }) {
    this.store = store;
    this.servers = servers;
    this.pollMs = pollMs;
    this.steamApiKey = steamApiKey;
    this.appId = appId;
    this.dataDir = dataDir;
    this.states = new Map(servers.map((server) => [server.id, emptyState()]));
    this.live = new Map();
    this.timer = null;
    this.busy = false;
    this.steamQueue = new Set();
    this.onTick = null;
    this.lastBoardAt = 0;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(serverId) {
    return this.states.get(String(serverId)) || null;
  }

  health(serverId) {
    return this.live.get(String(serverId)) || { online: false };
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const results = await Promise.allSettled(this.servers.map((server) => this.pollServer(server)));
      const matchEnded = results.some((result) => result.status === "fulfilled" && result.value);
      await this.flushSteam();
      this.persistBoard(matchEnded);
      this.onTick?.();
    } finally {
      this.busy = false;
    }
  }

  async pollServer(server) {
    try {
      const { status, players } = await fetchSnapshot(server);
      const state = this.states.get(server.id);
      const { events } = applyTick(state, {
        status,
        players,
        now: Date.now(),
        pollMs: this.pollMs,
      });
      const matchEnded = this.persist(server, state, events);
      this.live.set(server.id, { online: true, name: status.serverName || server.name });
      return matchEnded;
    } catch (error) {
      this.live.set(server.id, {
        online: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  persistBoard(force = false) {
    if (!this.dataDir) return;
    const now = Date.now();
    if (!force && now - this.lastBoardAt < 10 * 60 * 1000) return;
    try {
      persistTop100(this.store, this.dataDir);
      this.lastBoardAt = now;
    } catch (error) {
      console.warn("top100:", error instanceof Error ? error.message : error);
    }
  }

  persist(server, state, events) {
    const now = Date.now();
    let matchEnded = false;
    for (const player of state.roster) {
      this.store.touchPlayer(server.id, player, now);
      this.steamQueue.add(player.steamId);
    }

    for (const event of events) {
      if (event.type === "join") {
        this.store.openSession(server.id, event.player.steamId, event.at);
      }
      if (event.type === "tick_time") {
        this.store.addSeconds(event.steamId, Math.round(event.ms / 1000), server.id);
      }
      if (event.type === "leave") {
        this.store.closeSession(server.id, event.steamId, event.at);
      }
      if (event.type === "match_end") {
        matchEnded = true;
        for (const snapshot of event.snapshots) {
          this.store.recordMatch(server.id, snapshot, {
            map: event.map,
            mode: event.mode,
            startedAt: event.startedAt || state.match.startedAt,
            endedAt: now,
            winners: event.winners,
          });
        }
      }
    }
    return matchEnded;
  }

  async flushSteam() {
    const now = Date.now();
    const stale = this.store.staleSteamIds(now);
    const queued = [...this.steamQueue].slice(0, 20);
    this.steamQueue.clear();
    const ids = [...new Set([...stale, ...queued])].slice(0, 30);
    if (!ids.length) return;
    try {
      if (this.steamApiKey) {
        await enrichPlayers(this.store, {
          apiKey: this.steamApiKey,
          appId: this.appId,
          steamIds: ids,
          now,
        });
      } else {
        await enrichAvatars(this.store, ids, now);
      }
    } catch (error) {
      console.warn("steam enrich:", error instanceof Error ? error.message : error);
    }
  }
}
