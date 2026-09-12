import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
} from "discord.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPanelBanner } from "./card.js";
import { formatTopCsv, formatTopLine, persistTop100, TOP_LIMIT } from "./leaderboard.js";
import { formatHours, formatKd, prettyMode } from "./logic.js";

const LOGO_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "wardogs-logo.png");
const V2 = MessageFlags.IsComponentsV2;

export const COLOR = 0xe8a317;
export const PANEL_ASK = "wd:ask";
export const PANEL_ME = "wd:me";
export const PANEL_TOP = "wd:top";
export const PANEL_LIVE = "wd:live";
export const PANEL_MODAL = "wd:stats";

const METRIC_LABEL = {
  kills: "Килы",
  kd: "K/D",
  hours: "Часы",
  cash: "Кэш",
  wins: "Победы",
  matches: "Игры",
};

function serverSnapshot(poller, server) {
  const state = poller?.snapshot(server.id);
  const online = Math.max(state?.roster?.length || 0, Number(state?.status?.players?.current) || 0);
  const max = state?.status?.players?.max || "—";
  const map = state?.status?.map || "карта неизвестна";
  const mode = prettyMode(state?.status?.experiences?.[0]);
  const matchMin = Math.floor((Number(state?.status?.matchSeconds) || 0) / 60);
  const ranked = [...(state?.roster || [])].sort((a, b) => b.kills - a.kills).slice(0, 3);
  const top = ranked.map((player, index) => `\`${index + 1}\` **${player.name}** · **${player.kills}**`);
  const topNames = ranked.map((player) => `${player.name} ${player.kills}`);
  return { name: server.name, online, max, map, mode, matchMin, top, topNames };
}

function txt(content) {
  return new TextDisplayBuilder().setContent(content);
}

function line(large = false) {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

function logoFile() {
  return new AttachmentBuilder(LOGO_PATH, { name: "logo.png" });
}

function logoThumb() {
  return new ThumbnailBuilder().setURL("attachment://logo.png").setDescription("WARDOGS RUSSIAN");
}

function panelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PANEL_ASK).setStyle(ButtonStyle.Primary).setEmoji("📊").setLabel("Статистика"),
    new ButtonBuilder().setCustomId(PANEL_ME).setStyle(ButtonStyle.Success).setEmoji("👤").setLabel("Моя стата"),
    new ButtonBuilder().setCustomId(PANEL_TOP).setStyle(ButtonStyle.Secondary).setEmoji("🏆").setLabel("Топ"),
    new ButtonBuilder().setCustomId(PANEL_LIVE).setStyle(ButtonStyle.Secondary).setEmoji("📡").setLabel("Онлайн"),
  );
}

function serverBlock(snap) {
  const top = snap.top?.length ? snap.top.join("\n") : "_пока пусто_";
  return [
    `## ${snap.name}`,
    `**${snap.online}** / **${snap.max}** онлайн · ${snap.map} · ${snap.mode || "матч"} · ${snap.matchMin}м`,
    `Топ матча\n${top}`,
  ].join("\n");
}

export async function panelMessage(poller, servers, totals = {}) {
  const snaps = (servers || []).map((server) => serverSnapshot(poller, server));
  const games = Number(totals.games) || 0;
  const players = Number(totals.players) || 0;
  const files = [logoFile()];
  const container = new ContainerBuilder()
    .setAccentColor(COLOR)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          txt("# WARDOGS STATS"),
          txt(`Игр на серверах · **${games}**\nИгроков в базе · **${players}**`),
        )
        .setThumbnailAccessory(logoThumb()),
    )
    .addSeparatorComponents(line());

  try {
    const bannerName = `panel-${Date.now()}.png`;
    const banner = await renderPanelBanner(snaps, totals);
    files.push(new AttachmentBuilder(banner, { name: bannerName }));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${bannerName}`).setDescription("WARDOGS STATS live"),
      ),
    );
    container.addSeparatorComponents(line(true));
  } catch (error) {
    console.warn("panel banner:", error.message);
  }

  for (const [index, snap] of snaps.entries()) {
    if (index) container.addSeparatorComponents(line());
    container.addTextDisplayComponents(txt(serverBlock(snap)));
  }

  container
    .addSeparatorComponents(line(true))
    .addTextDisplayComponents(txt("-# Стата, топ-100 и онлайн в ЛС · кнопки раз в минуту · /приз фиксирует список"))
    .addActionRowComponents(panelButtons());

  return { components: [container], files, flags: V2 };
}

export function statsCardMessage(view, png) {
  const live = view.live
    ? `Сейчас на **${view.live.server}** · ${view.live.map || "матч"} · **${view.live.kills}/${view.live.deaths}**`
    : "Карточка с наших серверов WARDOGS RUSSIA.";
  const files = [logoFile()];
  if (png) files.push(new AttachmentBuilder(png, { name: "stats.png" }));
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      txt(`# ${view.name}`),
      txt(`${live}\n[\`${view.steamId}\`](https://steamcommunity.com/profiles/${view.steamId})`),
    )
    .setThumbnailAccessory(
      view.avatar
        ? new ThumbnailBuilder().setURL(view.avatar).setDescription(view.name)
        : logoThumb(),
    );
  const container = new ContainerBuilder().setAccentColor(COLOR).addSectionComponents(section);
  if (png) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL("attachment://stats.png").setDescription(view.name),
      ),
    );
  }
  return { components: [container], files, flags: V2 };
}

export function statsModal() {
  return new ModalBuilder()
    .setCustomId(PANEL_MODAL)
    .setTitle("Статистика игрока")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Ник или SteamID64")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("Nomad или 7656119…")
          .setMaxLength(64),
      ),
    );
}

export function statsTextMessage(store, player, view) {
  const extra = store.extras(player.steam_id);
  const faction = extra.factions[0];
  const map = extra.maps[0];
  const mates = extra.mates.map((row) => row.name).join(", ");
  const kills = view?.kills ?? player.kills;
  const deaths = view?.deaths ?? player.deaths;
  const body = [
    `# ${player.name || player.steam_id}`,
    `[\`${player.steam_id}\`](https://steamcommunity.com/profiles/${player.steam_id})`,
    `**${kills}** килов · **${deaths}** смертей · K/D **${formatKd(kills, deaths)}**`,
    `Часов у нас · **${formatHours(player.seconds_played)}**`,
    `Игр / победы · **${view?.games ?? player.matches}** / **${player.wins}**`,
    `Фракция · **${faction?.faction || player.last_faction || "—"}** · карта · **${map?.map || "—"}**`,
    mates ? `Часто играет с · ${mates}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    components: [new ContainerBuilder().setAccentColor(COLOR).addTextDisplayComponents(txt(body))],
    files: [logoFile()],
    flags: V2,
  };
}

export function topMessage(store, metric = "kills", { frozen = false, fileDir = "" } = {}) {
  const saved = fileDir
    ? persistTop100(store, fileDir, { reason: frozen ? "prize" : "auto", frozen, metric })
    : { rows: store.top(metric, TOP_LIMIT), file: null };
  const rows = saved.rows;
  if (!rows.length) return null;
  const title = frozen ? `# Топ ${rows.length} · призы` : `# Топ ${rows.length} · ${METRIC_LABEL[metric] || metric}`;
  const note = frozen
    ? `Зафиксировано для выдачи призов · ${rows.length} игроков`
    : `По завершённым матчам · ${rows.length} из ${TOP_LIMIT} · CSV во вложении`;
  const container = new ContainerBuilder()
    .setAccentColor(COLOR)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(txt(title), txt(note))
        .setThumbnailAccessory(logoThumb()),
    );
  for (let i = 0; i < rows.length; i += 20) {
    container.addSeparatorComponents(line());
    container.addTextDisplayComponents(
      txt(rows.slice(i, i + 20).map((row, offset) => formatTopLine(row, i + offset, metric)).join("\n")),
    );
  }
  const files = [logoFile()];
  const csvName = frozen ? `prize-top100.csv` : `top100-${metric}.csv`;
  files.push(new AttachmentBuilder(Buffer.from(formatTopCsv(rows, { metric }), "utf8"), { name: csvName }));
  return { components: [container], files, flags: V2 };
}

export function liveMessage(poller, servers) {
  const container = new ContainerBuilder()
    .setAccentColor(COLOR)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(txt("# Онлайн"), txt("Текущий матч на наших серверах"))
        .setThumbnailAccessory(logoThumb()),
    );
  for (const server of servers) {
    const health = poller.health(server.id);
    const state = poller.snapshot(server.id);
    container.addSeparatorComponents(line());
    if (!health.online || !state?.status) {
      container.addTextDisplayComponents(txt(`## ${server.name}\nСервер не отвечает.`));
      continue;
    }
    const status = state.status;
    const top = [...state.roster]
      .sort((a, b) => b.kills - a.kills || b.cash - a.cash)
      .slice(0, 8)
      .map((player, index) => `\`${index + 1}\` **${player.name}** · ${player.kills}/${player.deaths} · $${player.cash}`)
      .join("\n");
    const scores = (status.factionScores || [])
      .map((row) => `**${row.name}** ${Number(row.score) || 0}`)
      .join("  ·  ");
    container.addTextDisplayComponents(
      txt(
        [
          `## ${status.serverName || server.name}`,
          `${status.map || "—"} · ${prettyMode(status.experiences?.[0])} · **${state.roster.length}/${status.players?.max || "—"}** · ${Math.floor((status.matchSeconds || 0) / 60)}м`,
          scores,
          top ? `Топ матча\n${top}` : "_в ростере пусто_",
        ].join("\n"),
      ),
    );
  }
  return { components: [container], files: [logoFile()], flags: V2 };
}

const bumpLock = new Set();
const lastPaint = new Map();

function panelFingerprint(poller, servers, totals) {
  const snaps = (servers || []).map((server) => serverSnapshot(poller, server));
  return JSON.stringify({
    games: totals.games,
    players: totals.players,
    snaps: snaps.map((snap) => ({
      name: snap.name,
      online: snap.online,
      max: snap.max,
      map: snap.map,
      mode: snap.mode,
      matchMin: snap.matchMin,
    })),
  });
}

export async function placePanel(channel, store, poller, servers) {
  if (!channel || bumpLock.has(channel.id)) return;
  bumpLock.add(channel.id);
  try {
    const prev = store.panel(channel.id);
    if (prev?.message_id) {
      await channel.messages.delete(prev.message_id).catch(() => {});
    }
    const totals = store.totals();
    const sent = await channel.send(await panelMessage(poller, servers, totals));
    store.savePanel(channel.id, sent.id, channel.guildId);
    lastPaint.set(channel.id, panelFingerprint(poller, servers, totals));
    return sent;
  } finally {
    bumpLock.delete(channel.id);
  }
}

export async function refreshPanel(channel, store, poller, servers) {
  if (!channel || bumpLock.has(channel.id)) return;
  const prev = store.panel(channel.id);
  if (!prev?.message_id) return;
  const totals = store.totals();
  const finger = panelFingerprint(poller, servers, totals);
  if (lastPaint.get(channel.id) === finger) return;
  bumpLock.add(channel.id);
  let repost = false;
  try {
    const message = await channel.messages.fetch(prev.message_id).catch(() => null);
    if (!message) {
      repost = true;
    } else {
      await message.edit(await panelMessage(poller, servers, totals));
      lastPaint.set(channel.id, finger);
    }
  } catch (error) {
    console.warn("panel refresh:", error.message);
    if (/Unknown Message|Invalid Form Body/i.test(error.message || "")) repost = true;
  } finally {
    bumpLock.delete(channel.id);
  }
  if (repost) await placePanel(channel, store, poller, servers).catch(() => {});
}

export async function refreshAllPanels(client, store, poller, servers) {
  for (const row of store.panels()) {
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    if (channel) await refreshPanel(channel, store, poller, servers);
  }
}

export async function bumpPanel(channel, store, poller, servers) {
  const prev = store.panel(channel.id);
  if (!prev) return;
  const last = channel.lastMessageId;
  if (last && last === prev.message_id) {
    await refreshPanel(channel, store, poller, servers);
    return;
  }
  await placePanel(channel, store, poller, servers);
}
