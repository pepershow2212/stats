import { dirname } from "node:path";
import { startBot } from "./bot.js";
import { describeCardFonts } from "./card.js";
import { config, envFileExists, trackedServers } from "./config.js";
import { openDb } from "./db.js";
import { startMockRcon } from "./mock-rcon.js";
import { Poller } from "./poller.js";

async function main() {
  console.log("сборка царь-слот-6 — без спама reserve fetch failed");
  const servers = trackedServers();
  if (!servers.length) {
    if (!envFileExists()) {
      console.error("нет .env и нет SERVER_* в окружении — скопируй .env.example или задай переменные на хосте");
    } else {
      console.error("Нет RCON. Заполни SERVER_1_RCON_HOST и PASSWORD или запусти: npm run mock");
    }
    process.exit(1);
  }

  if (!envFileExists()) {
    console.log("файла .env нет — беру Discord и RCON из переменных окружения");
  }

  const fonts = describeCardFonts();
  console.log(
    `шрифты: ${fonts.registered.join(", ") || "не найдены"} · sample ${fonts.sampleWidth.toFixed(0)}px${fonts.ok ? "" : " — текст на карточке может пропасть"}`,
  );

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
    dataDir: dirname(config.databasePath),
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
