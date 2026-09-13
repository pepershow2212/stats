import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(root, ".env") });

function env(name, fallback = "") {
  const value = process.env[name];
  return value == null || value === "" ? fallback : value;
}

function flag(name) {
  return ["1", "true", "yes"].includes(String(process.env[name] || "").toLowerCase());
}

export function makeServer(id) {
  const key = String(id);
  const host = env(`SERVER_${key}_RCON_HOST`);
  const password = env(`SERVER_${key}_RCON_PASSWORD`);
  return {
    id: key,
    name: env(`SERVER_${key}_NAME`, `СЕРВЕР ${key}`),
    host,
    port: Number(env(`SERVER_${key}_RCON_PORT`, "7776")) || 7776,
    password,
    tls: flag(`SERVER_${key}_RCON_TLS`),
    enabled: Boolean(host && password),
  };
}

const argv = new Set(process.argv.slice(2));

export const config = {
  root,
  discordToken: env("DISCORD_TOKEN") || env("DISCORD_BOT_TOKEN") || env("BOT_TOKEN"),
  discordClientId: env("DISCORD_CLIENT_ID"),
  discordGuildId: env("DISCORD_GUILD_ID"),
  steamApiKey: env("STEAM_API_KEY"),
  appId: env("WARDOGS_APP_ID", "1867240"),
  databasePath: resolve(root, env("DATABASE_PATH", process.env.DATA_DIR ? `${process.env.DATA_DIR}/stats.db` : "./data/stats.db")),
  pollMs: Math.max(2000, Number(env("POLL_INTERVAL_MS", "4000")) || 4000),
  mockRcon: flag("MOCK_RCON") || argv.has("--mock"),
  pollerOnly: argv.has("--poller-only"),
  servers: [1, 2, 3, 4].map(makeServer),
  kingRoleName: env("KING_ROLE_NAME", "Царь горы"),
  kingRoleId: env("KING_ROLE_ID"),
  kingChannelId: env("KING_CHANNEL_ID"),
};

export function trackedServers() {
  if (config.mockRcon) {
    return [
      {
        id: "1",
        name: env("SERVER_1_NAME", "СЕРВЕР 1"),
        host: "127.0.0.1",
        port: Number(env("MOCK_RCON_PORT", "17776")) || 17776,
        password: "demo",
        tls: false,
        enabled: true,
      },
    ];
  }
  return config.servers.filter((server) => server.enabled);
}

export function getServer(id) {
  const key = String(id || "").replace(/^server[-_\s]*/i, "");
  return trackedServers().find((server) => server.id === key) || null;
}

export function envFileExists() {
  return existsSync(resolve(root, ".env"));
}
