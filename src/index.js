import { startBot } from "./bot.js";
import { config, envFileExists, trackedServers } from "./config.js";
import { openDb } from "./db.js";
import { startMockRcon } from "./mock-rcon.js";
import { Poller } from "./poller.js";

async function main() {
  if (!envFileExists()) {
    console.warn("нет .env — скопируй .env.example");
  }

  const servers = trackedServers();
  if (!servers.length) {
    console.error("Нет RCON. Заполни SERVER_1_RCON_HOST и PASSWORD или запусти: npm run mock");
    process.exit(1);
  }

  let mock = null;
  if (config.mockRcon) {
    mock = await startMockRcon(servers[0].port);
  }

  const store = openDb(config.databasePath);
  const poller = new Poller({
    store,
    servers,
    pollMs: config.pollMs,
    steamApiKey: config.steamApiKey,
    appId: config.appId,
  });
  poller.start();
  console.log(`поллер: ${servers.map((server) => server.name).join(", ")} каждые ${config.pollMs} мс`);

  if (!config.pollerOnly && config.discordToken) {
    await startBot({
      token: config.discordToken,
      clientId: config.discordClientId,
      guildId: config.discordGuildId,
      store,
      poller,
      servers,
    });
  } else if (!config.discordToken) {
    console.log("DISCORD_TOKEN пуст — работаю только как поллер");
  }

  const shutdown = async () => {
    poller.stop();
    store.close();
    if (mock) await mock.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
