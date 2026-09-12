import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { renderStatsCard } from "./card.js";
import { fetchCommunityProfile } from "./steam.js";
import { Cooldown } from "./cooldown.js";
import { isSteamId64 } from "./logic.js";
import { resolveSteamId } from "./lookup.js";
import { buildView } from "./view.js";
import {
  PANEL_ASK,
  PANEL_LIVE,
  PANEL_ME,
  PANEL_MODAL,
  PANEL_TOP,
  bumpPanel,
  liveMessage,
  placePanel,
  refreshAllPanels,
  statsCardMessage,
  statsModal,
  statsTextMessage,
  topMessage,
} from "./panel.js";
const METRICS = [
  { name: "Килы", value: "kills" },
  { name: "K/D", value: "kd" },
  { name: "Часы", value: "hours" },
  { name: "Кэш", value: "cash" },
  { name: "Победы", value: "wins" },
  { name: "Игры", value: "matches" },
];

const usageCd = new Cooldown(60_000);

function serverChoices(servers) {
  return servers.slice(0, 25).map((server) => ({ name: server.name, value: server.id }));
}

export function buildCommands(servers) {
  const choices = serverChoices(servers);
  const stats = new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Player stats on our WARDOGS servers")
    .setDescriptionLocalization("ru", "Статистика игрока на наших серверах")
    .addStringOption((option) =>
      option
        .setName("ник")
        .setDescription("Ник или SteamID64")
        .setDescriptionLocalization("ru", "Ник или SteamID64")
        .setAutocomplete(true),
    )
    .addUserOption((option) =>
      option.setName("игрок").setDescription("Участник Discord").setDescriptionLocalization("ru", "Участник Discord"),
    );

  const top = new SlashCommandBuilder()
    .setName("top")
    .setDescription("Leaderboard")
    .setDescriptionLocalization("ru", "Таблица лидеров")
    .addStringOption((option) =>
      option
        .setName("метрика")
        .setDescription("What to rank")
        .setDescriptionLocalization("ru", "Что ранжировать")
        .addChoices(...METRICS),
    );

  const live = new SlashCommandBuilder()
    .setName("live")
    .setDescription("Current match")
    .setDescriptionLocalization("ru", "Текущий матч");

  if (choices.length > 1) {
    live.addStringOption((option) =>
      option
        .setName("сервер")
        .setDescription("Server")
        .setDescriptionLocalization("ru", "Сервер")
        .addChoices(...choices),
    );
  }

  const link = new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your SteamID64")
    .setDescriptionLocalization("ru", "Привязать SteamID64")
    .addStringOption((option) =>
      option
        .setName("steamid")
        .setDescription("SteamID64, starts with 7656119")
        .setDescriptionLocalization("ru", "SteamID64, начинается с 7656119")
        .setRequired(true),
    );

  const unlink = new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Unlink Steam")
    .setDescriptionLocalization("ru", "Отвязать Steam");

  const panel = new SlashCommandBuilder()
    .setName("панель")
    .setDescription("Постоянная панель статистики внизу канала")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  return [stats, top, live, link, unlink, panel];
}

export async function startBot({ token, clientId, guildId, store, poller, servers }) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });
  const allowed = { id: guildId || "" };

  client.once(Events.ClientReady, async (ready) => {
    console.log(`discord: ${ready.user.tag}`);
    ready.user.setActivity("считаю игроков…", { type: ActivityType.Watching });
    const rest = new REST({ version: "10" }).setToken(token);
    const body = buildCommands(servers).map((command) => command.toJSON());
    const appId = ready.application?.id || clientId || ready.user.id;
    await ready.guilds.fetch().catch(() => {});
    const guilds = [...ready.guilds.cache.values()];
    console.log(
      "discord: вижу серверы:",
      guilds.map((guild) => `${guild.name} (${guild.id})`).join(", ") || "ни одного",
    );

    try {
      await rest.put(Routes.applicationCommands(appId), { body: [] });
    } catch (error) {
      console.warn("discord: не снял глобальные команды:", error.message);
    }

    const targets = [];
    if (allowed.id) targets.push(allowed.id);
    for (const guild of guilds) {
      if (!targets.includes(guild.id)) targets.push(guild.id);
    }

    for (const id of targets) {
      try {
        await rest.put(Routes.applicationGuildCommands(appId, id), { body });
        console.log(`discord: команды на ${id}`);
      } catch (error) {
        console.warn(`discord: команды не встали на ${id}:`, error.message);
      }
    }

    const pushActivity = () => refreshActivity(ready, poller, servers);
    let lastPanelAt = 0;
    const pushPanels = () => {
      const now = Date.now();
      if (now - lastPanelAt < 15_000) return;
      lastPanelAt = now;
      void refreshAllPanels(ready, store, poller, servers);
    };
    pushActivity();
    setInterval(pushActivity, 10_000);
    setInterval(pushPanels, 15_000);
    poller.onTick = () => {
      pushActivity();
      pushPanels();
    };
    for (const row of store.panels()) {
      const channel = await ready.channels.fetch(row.channel_id).catch(() => null);
      if (channel) await placePanel(channel, store, poller, servers).catch(() => {});
    }
    lastPanelAt = 0;
    pushPanels();
  });

  client.on(Events.GuildDelete, (guild) => {
    console.warn(`discord: сняли с сервера ${guild.name || "?"} (${guild.id})`);
  });

  client.on(Events.GuildCreate, async (guild) => {
    console.log(`discord: добавили на ${guild.name} (${guild.id})`);
    if (allowed.id && guild.id !== allowed.id) {
      console.warn(`discord: жду сервер ${allowed.id}, это другой — команды всё равно ставлю`);
    }
    const rest = new REST({ version: "10" }).setToken(token);
    const body = buildCommands(servers).map((command) => command.toJSON());
    const appId = client.application?.id || clientId;
    try {
      await rest.put(Routes.applicationGuildCommands(appId, guild.id), { body });
      allowed.id = guild.id;
      console.log(`discord: команды на ${guild.id}`);
    } catch (error) {
      console.warn(`discord: команды не встали на ${guild.id}:`, error.message);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!store.panel(message.channelId)) return;
    await bumpPanel(message.channel, store, poller, servers).catch(() => {});
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (allowed.id && interaction.guildId && interaction.guildId !== allowed.id) {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: "Этот бот работает только на основном сервере.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return;
    }
    try {
      if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused();
        const rows = store.suggestPlayers(focused);
        await interaction.respond(
          rows.slice(0, 25).map((row) => ({
            name: `${row.name} · ${row.kills} килов`.slice(0, 100),
            value: row.steam_id,
          })),
        );
        return;
      }
      if (interaction.isButton() && interaction.customId === PANEL_ASK) {
        await interaction.showModal(statsModal());
        return;
      }
      if (interaction.isButton() && interaction.customId === PANEL_ME) {
        if (await denyCooldown(interaction)) return;
        if (await replyStats(interaction, store, poller, servers, "")) usageCd.hit(interaction.user.id);
        await bumpPanel(interaction.channel, store, poller, servers);
        return;
      }
      if (interaction.isButton() && interaction.customId === PANEL_TOP) {
        if (await denyCooldown(interaction)) return;
        if (await cmdTop(interaction, store, "kills")) usageCd.hit(interaction.user.id);
        await bumpPanel(interaction.channel, store, poller, servers);
        return;
      }
      if (interaction.isButton() && interaction.customId === PANEL_LIVE) {
        if (await denyCooldown(interaction)) return;
        if (await cmdLive(interaction, poller, servers)) usageCd.hit(interaction.user.id);
        await bumpPanel(interaction.channel, store, poller, servers);
        return;
      }
      if (interaction.isModalSubmit() && interaction.customId === PANEL_MODAL) {
        if (await denyCooldown(interaction)) return;
        if (await replyStats(interaction, store, poller, servers, interaction.fields.getTextInputValue("query"))) {
          usageCd.hit(interaction.user.id);
        }
        await bumpPanel(interaction.channel, store, poller, servers);
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === "stats") {
        if (await denyCooldown(interaction)) return;
        if (await cmdStats(interaction, store, poller, servers)) usageCd.hit(interaction.user.id);
      } else if (interaction.commandName === "top") {
        if (await denyCooldown(interaction)) return;
        if (await cmdTop(interaction, store, interaction.options.getString("метрика"))) usageCd.hit(interaction.user.id);
      } else if (interaction.commandName === "live") {
        if (await denyCooldown(interaction)) return;
        if (await cmdLive(interaction, poller, servers)) usageCd.hit(interaction.user.id);
      }
      else if (interaction.commandName === "link") await cmdLink(interaction, store);
      else if (interaction.commandName === "unlink") await cmdUnlink(interaction, store);
      else if (interaction.commandName === "панель") {
        await placePanel(interaction.channel, store, poller, servers);
        await interaction.reply({ content: "Панель внизу канала.", flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      console.error("command", interaction.commandName || interaction.customId, error);
      const text = "Не получилось ответить. Попробуй ещё раз.";
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral }).catch(() => {});
      else if (interaction.isRepliable()) await interaction.reply({ content: text, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });

  await client.login(token);
  return client;
}

function serverOnline(poller, server) {
  const state = poller.snapshot(server.id);
  const roster = state?.roster?.length || 0;
  const reported = Number(state?.status?.players?.current) || 0;
  return Math.max(roster, reported);
}

function refreshActivity(client, poller, servers) {
  const counts = servers.map((server) => serverOnline(poller, server));
  if (!counts.some((n) => n > 0) && !servers.some((server) => poller.health(server.id).online)) {
    client.user.setActivity("серверы молчат · /stats", { type: ActivityType.Watching });
    return;
  }
  const total = counts.reduce((sum, n) => sum + n, 0);
  const byServer = counts.map((n, i) => `#${servers[i].id} ${n}`).join(" · ");
  client.user.setActivity(`${total} онлайн · ${byServer}`, { type: ActivityType.Watching });
}

async function denyCooldown(interaction) {
  const left = usageCd.remaining(interaction.user.id);
  if (left <= 0) return false;
  await interaction.reply({
    content: `Подожди ${Math.ceil(left / 1000)}с — карточка и кнопки раз в минуту.`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function acknowledge(interaction) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

async function replyPrivate(interaction, payload, ack) {
  await acknowledge(interaction);
  if (!interaction.guildId) {
    await interaction.followUp(payload);
    return true;
  }
  try {
    await interaction.user.send(payload);
    await interaction.editReply({ content: ack || "Отправил в личку." });
    return true;
  } catch {
    await interaction.editReply({ content: "ЛС закрыты — карточка ниже, только ты видишь." });
    await interaction.followUp({
      components: payload.components,
      files: payload.files,
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return true;
  }
}

async function replyStats(interaction, store, poller, servers, raw) {
  await acknowledge(interaction);
  const found = resolveSteamId(store, interaction, raw);
  if (!found.steamId) {
    await interaction.editReply({ content: found.note });
    return false;
  }
  const player = store.player(found.steamId);
  if (!player) {
    await interaction.editReply({ content: `В базе нет \`${found.steamId}\`.` });
    return false;
  }
  const view = buildView(store, poller, servers, player);
  if (!view.avatar) {
    try {
      const profile = await fetchCommunityProfile(player.steam_id);
      if (profile?.avatar) {
        store.updateAvatar(player.steam_id, profile.avatar, Date.now());
        view.avatar = profile.avatar;
      }
    } catch (error) {
      console.warn("steam avatar:", error.message);
    }
  }
  const own = store.linkForDiscord(interaction.user.id);
  if (!view.avatar && own?.steam_id === player.steam_id) {
    view.avatar = interaction.user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true });
  }
  let payload;
  try {
    payload = statsCardMessage(view, await renderStatsCard(view));
  } catch (error) {
    console.warn("card:", error.message);
    payload = statsTextMessage(store, player, view);
  }
  return replyPrivate(interaction, payload, `Карточка **${view.name}** в личке.`);
}

async function cmdStats(interaction, store, poller, servers) {
  return replyStats(interaction, store, poller, servers, interaction.options.getString("ник"));
}

async function cmdTop(interaction, store, metric) {
  const picked = metric || interaction.options?.getString?.("метрика") || "kills";
  const payload = topMessage(store, picked);
  if (!payload) {
    await interaction.reply({ content: "Пока пусто — статистика копится с конца матчей.", flags: MessageFlags.Ephemeral });
    return false;
  }
  return replyPrivate(interaction, payload, "Топ в личке.");
}

async function cmdLive(interaction, poller, servers) {
  const id = interaction.options?.getString?.("сервер");
  const list = id ? servers.filter((server) => server.id === id) : servers;
  if (!list.length) {
    await interaction.reply({ content: "Серверы не настроены.", flags: MessageFlags.Ephemeral });
    return false;
  }
  return replyPrivate(interaction, liveMessage(poller, list), "Онлайн в личке.");
}

async function cmdLink(interaction, store) {
  const steamId = String(interaction.options.getString("steamid") || "").trim();
  if (!isSteamId64(steamId)) {
    await interaction.reply({
      content: "Нужен SteamID64. Он выглядит так: `76561198000000000`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  store.link(interaction.user.id, steamId, Date.now());
  await interaction.reply({ content: `Привязал ${interaction.user} → \`${steamId}\`.`, flags: MessageFlags.Ephemeral });
}

async function cmdUnlink(interaction, store) {
  store.unlinkDiscord(interaction.user.id);
  await interaction.reply({ content: "Steam отвязан.", flags: MessageFlags.Ephemeral });
}
