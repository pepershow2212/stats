import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, trackedServers } from "./config.js";
import { formatVipStatus, getVipCapacity } from "./vip.js";

const LOGO_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "wardogs-logo.png");
const V2 = MessageFlags.IsComponentsV2;
const COLOR = 0xc9a227;

export const VIP_PANEL_STATUS = "wd:vip:status";
export const VIP_PANEL_HOW = "wd:vip:how";

let lastFingerprint = new Map();

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
  return new ThumbnailBuilder().setURL("attachment://logo.png").setDescription("WARDOGS VIP");
}

function vipButtons(canBuy) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VIP_PANEL_STATUS).setStyle(ButtonStyle.Success).setLabel("Мой VIP"),
    new ButtonBuilder().setCustomId(VIP_PANEL_HOW).setStyle(ButtonStyle.Secondary).setLabel("Как купить"),
  );
  const url = String(config.vipDonateUrl || "").trim();
  if (canBuy && /^https?:\/\//i.test(url)) {
    row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Оплатить").setURL(url));
  }
  return row;
}

export async function vipPanelMessage(store, servers = trackedServers()) {
  const capacity = await getVipCapacity(store, servers);
  const serversLabel = config.vipServerIds.map((id) => `#${id}`).join(" и ");
  const url = config.vipDonateUrl || "задай VIP_DONATE_URL в .env";
  const roleName = config.vipRoleName || "VIP";
  const stock = capacity.full
    ? `⛔ **Слоты закончились** — сейчас покупать нельзя`
    : `✅ **Можно купить** — свободно **${capacity.open}**`;

  const king = store.latestKing?.() || null;
  const kingLine = king?.steam_id
    ? `Царь горы сейчас: **${king.name || "есть"}** — слот отдельно, в ${capacity.active}/${capacity.max} не входит`
    : `Царь горы — слот отдельно, в счётчик платных VIP не входит`;

  const container = new ContainerBuilder()
    .setAccentColor(COLOR)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          txt("# WARDOGS VIP"),
          txt(`Приоритет в очереди на **${serversLabel}** + роль **${roleName}** в Discord.`),
        )
        .setThumbnailAccessory(logoThumb()),
    )
    .addSeparatorComponents(line())
    .addTextDisplayComponents(
      txt(
        [
          "## Платные VIP",
          `# **${capacity.active} / ${capacity.max}**`,
          stock,
          "",
          kingLine,
        ].join("\n"),
      ),
    )
    .addSeparatorComponents(line())
    .addTextDisplayComponents(
      txt(
        [
          "## Что даёт VIP",
          `• **приоритет в очереди** — быстрее заходишь, когда сервер полный`,
          `• роль **${roleName}** в Discord — выдаётся и снимается автоматически`,
          `• действует на серверах **${serversLabel}**`,
          "",
          "## Цена",
          `**${config.vipPriceRub} ₽** = **${config.vipDays} дней**`,
          `Пример: **${config.vipPriceRub * 2} ₽** = **${config.vipDays * 2} дней**`,
        ].join("\n"),
      ),
    )
    .addSeparatorComponents(line())
    .addTextDisplayComponents(
      txt(
        [
          "## Как купить — по шагам",
          "",
          "**Шаг 1.** Привяжи Steam в Discord (один раз)",
          "Команда: `/link` + свой SteamID64",
          "Пример: `76561198000000000`",
          "",
          "**Шаг 2.** Оплати на Boosty",
          url,
          `Сумма от **${config.vipPriceRub} ₽** = **${config.vipDays} дней**`,
          "",
          "**Шаг 3.** В сообщении к донату на Boosty напиши свой **SteamID64**",
          "Без SteamID бот не сможет выдать VIP автоматически.",
          "",
          "**Шаг 4.** Бот сам выдаст VIP (~1 минута):",
          "• приоритет в очереди на серверах",
          "• роль Discord",
          "",
          "Если авто не сработало — напиши админам (тикет), выдадут вручную.",
          "",
          "**Проверка:** кнопка **Мой VIP** — статус, оплата, срок.",
          "",
          "Царь горы получает VIP бесплатно и **не занимает** платный слот.",
          "Царь горы и платный VIP не мешают друг другу.",
        ].join("\n"),
      ),
    )
    .addSeparatorComponents(line(true))
    .addActionRowComponents(vipButtons(!capacity.full));

  return {
    components: [container],
    files: [logoFile()],
    flags: V2,
    _finger: `${capacity.active}/${capacity.max}/${capacity.full ? 1 : 0}/${king?.steam_id || "-"}`,
  };
}

export async function placeVipPanel(channel, store, servers = trackedServers()) {
  if (!channel) return null;
  const prev = store.vipPanel(channel.id);
  if (prev?.message_id) {
    await channel.messages.delete(prev.message_id).catch(() => {});
  }
  const payload = await vipPanelMessage(store, servers);
  const { _finger, ...body } = payload;
  const sent = await channel.send(body);
  store.saveVipPanel(channel.id, sent.id, channel.guildId);
  lastFingerprint.set(channel.id, _finger);
  return sent;
}

export async function removeVipPanel(channel, store) {
  const prev = store.vipPanel(channel?.id);
  if (!prev) return false;
  if (channel && prev.message_id) {
    await channel.messages.delete(prev.message_id).catch(() => {});
  }
  store.dropVipPanel(channel.id);
  lastFingerprint.delete(channel.id);
  return true;
}

export async function removeAllVipPanels(client, store) {
  let count = 0;
  for (const row of store.vipPanels()) {
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    if (channel) {
      if (await removeVipPanel(channel, store)) count += 1;
    } else {
      store.dropVipPanel(row.channel_id);
      count += 1;
    }
  }
  return count;
}

export async function refreshVipPanels(client, store, servers = trackedServers()) {
  for (const row of store.vipPanels()) {
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    if (!channel) continue;
    const payload = await vipPanelMessage(store, servers);
    const { _finger, ...body } = payload;
    if (lastFingerprint.get(channel.id) === _finger) continue;
    const message = await channel.messages.fetch(row.message_id).catch(() => null);
    if (!message) {
      await placeVipPanel(channel, store, servers).catch(() => {});
      continue;
    }
    try {
      await message.edit(body);
      lastFingerprint.set(channel.id, _finger);
    } catch {
      await placeVipPanel(channel, store, servers).catch(() => {});
    }
  }
}

export function replyVipStatus(store, user) {
  return formatVipStatus(store, user);
}
