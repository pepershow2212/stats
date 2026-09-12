import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FACE = {
  regular: "WD Regular",
  bold: "WD Bold",
  extra: "WD ExtraBold",
};
const registered = new Set();

function registerFont(path, name) {
  if (!path || !existsSync(path) || registered.has(name)) return false;
  try {
    if (GlobalFonts.registerFromPath(path, name) !== false) {
      registered.add(name);
      return true;
    }
  } catch (error) {
    console.warn("fonts:", path, error.message);
  }
  return false;
}

export function registerCardFonts() {
  const bundled = join(ROOT, "assets", "fonts");
  registerFont(join(bundled, "NotoSans-Regular.ttf"), FACE.regular);
  registerFont(join(bundled, "NotoSans-Bold.ttf"), FACE.bold);
  registerFont(join(bundled, "NotoSans-ExtraBold.ttf"), FACE.extra);

  const dirs = [
    bundled,
    "/usr/src/app/assets/fonts",
    "/app/assets/fonts",
    "/usr/share/fonts/truetype/noto",
    "/usr/share/fonts/opentype/noto",
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype/liberation",
  ];
  const want = [
    { name: FACE.regular, match: /^(NotoSans-Regular|DejaVuSans|LiberationSans-Regular)\.ttf$/i },
    { name: FACE.bold, match: /^(NotoSans-Bold|NotoSans-SemiBold|DejaVuSans-Bold|LiberationSans-Bold)\.ttf$/i },
    { name: FACE.extra, match: /^(NotoSans-ExtraBold|NotoSans-Black)\.ttf$/i },
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let files = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const spec of want) {
      const file = files.find((name) => spec.match.test(name));
      if (file) registerFont(join(dir, file), spec.name);
    }
  }
  return [...registered];
}

registerCardFonts();

function faceName(weight = 400) {
  const n = Number(weight) || 400;
  if (n >= 800 && registered.has(FACE.extra)) return FACE.extra;
  if (n >= 600 && registered.has(FACE.bold)) return FACE.bold;
  if (registered.has(FACE.regular)) return FACE.regular;
  if (registered.has(FACE.bold)) return FACE.bold;
  return FACE.regular;
}

function fontFace(weight = 400) {
  return `"${faceName(weight)}"`;
}

export function describeCardFonts() {
  const canvas = createCanvas(80, 40);
  const ctx = canvas.getContext("2d");
  ctx.font = `28px ${fontFace(800)}`;
  const width = ctx.measureText("WАБ").width;
  const families = (GlobalFonts.families || []).map((row) => row.family || row).filter(Boolean);
  return {
    registered: [...registered],
    sampleWidth: width,
    ok: width > 12,
    families: families.filter((name) => /WD |Noto|DejaVu|Liberation|Segoe/i.test(name)),
  };
}

const COVER_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "wardogs-cover.jpg");
const LOGO_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "wardogs-logo.png");
let coverImage;
let coverTried = false;
let logoImage;
let logoTried = false;

async function getCover() {
  if (coverTried) return coverImage || null;
  coverTried = true;
  try {
    coverImage = await loadImage(COVER_PATH);
  } catch {
    coverImage = null;
  }
  return coverImage;
}

async function getLogo() {
  if (logoTried) return logoImage || null;
  logoTried = true;
  try {
    logoImage = await loadImage(LOGO_PATH);
  } catch {
    logoImage = null;
  }
  return logoImage;
}

async function drawLogo(ctx, x, y, size) {
  const logo = await getLogo();
  if (!logo) return false;
  ctx.drawImage(logo, x, y, size, size);
  return true;
}

function coverRect(image, w, h, pad = 56) {
  const scale = Math.max((w + pad * 2) / image.width, (h + pad * 2) / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  return { x: (w - dw) / 2, y: (h - dh) / 2, dw, dh };
}

async function paintScene(ctx, w, h, { blur = 14, dim = 0.28 } = {}) {
  ctx.fillStyle = "#0b0b0d";
  ctx.fillRect(0, 0, w, h);
  const image = await getCover();
  if (image) {
    const box = coverRect(image, w, h);
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(image, box.x, box.y, box.dw, box.dh);
    ctx.restore();
  } else {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#0b0b0d");
    bg.addColorStop(1, "#16120c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fillStyle = `rgba(8, 8, 10, ${dim})`;
  ctx.fillRect(0, 0, w, h);
  const veil = ctx.createLinearGradient(0, 0, w * 0.72, 0);
  veil.addColorStop(0, "rgba(8, 8, 10, 0.42)");
  veil.addColorStop(1, "rgba(8, 8, 10, 0)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, w, h);
  ctx.filter = "none";
}

const W = 1400;
const H = 720;
const ORANGE = "#e8a317";
const MUTED = "#8b867c";
const WHITE = "#f4f4f5";

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function text(ctx, value, x, y, { size = 28, color = WHITE, align = "left", weight = "600" } = {}) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.font = `${size}px ${fontFace(weight)}`;
  ctx.fillText(String(value ?? "—"), x, y);
  ctx.restore();
}

function fitName(ctx, value, maxWidth) {
  let size = 54;
  while (size > 28) {
    ctx.font = `${size}px ${fontFace(800)}`;
    if (ctx.measureText(value).width <= maxWidth) return size;
    size -= 2;
  }
  return 28;
}

function drawInitials(ctx, name, x, y, size) {
  const letter = String(name || "?")
    .replace(/[^A-Za-zА-Яа-яЁё0-9]/g, "")
    .slice(0, 1)
    .toUpperCase() || "?";
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1610";
  ctx.fill();
  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = ORANGE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(size * 0.42)}px ${fontFace(800)}`;
  ctx.fillText(letter, x + size / 2, y + size / 2 + 2);
  ctx.restore();
}

async function drawAvatar(ctx, url, x, y, size) {
  if (!url) return false;
  try {
    const image = await loadImage(url);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(image, x, y, size, size);
    ctx.restore();
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.stroke();
    return true;
  } catch {
    return false;
  }
}

function drawSoldier(ctx, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#17150f";
  ctx.beginPath();
  ctx.ellipse(0, 250, 170, 40, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2c281d";
  ctx.beginPath();
  ctx.moveTo(-110, 30);
  ctx.lineTo(-150, 210);
  ctx.lineTo(150, 210);
  ctx.lineTo(110, 30);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#3b3424";
  ctx.beginPath();
  ctx.ellipse(0, -20, 58, 68, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4d4330";
  ctx.beginPath();
  ctx.ellipse(0, -42, 68, 42, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "#2a261c";
  ctx.fillRect(-68, -42, 136, 14);
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(42, -8, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function strokeIcon(ctx, size, color, draw) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.8, size / 12);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  draw(size);
  ctx.restore();
}

function drawIcon(ctx, kind, x, y, size = 22, color = ORANGE) {
  ctx.save();
  ctx.translate(x, y);
  strokeIcon(ctx, size, color, (s) => {
    if (kind === "games") {
      ctx.beginPath();
      ctx.moveTo(s * 0.22, s * 0.12);
      ctx.lineTo(s * 0.22, s * 0.88);
      ctx.lineTo(s * 0.88, s * 0.5);
      ctx.closePath();
      ctx.stroke();
    } else if (kind === "clock") {
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s / 2, s / 2);
      ctx.lineTo(s / 2, s * 0.28);
      ctx.moveTo(s / 2, s / 2);
      ctx.lineTo(s * 0.74, s * 0.58);
      ctx.stroke();
    } else if (kind === "steam") {
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.4, s * 0.62, s * 0.14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.52);
      ctx.lineTo(s * 0.68, s * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.7, s * 0.28, s * 0.1, 0, Math.PI * 2);
      ctx.stroke();
    } else if (kind === "wins") {
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.08);
      ctx.lineTo(s * 0.62, s * 0.4);
      ctx.lineTo(s * 0.95, s * 0.4);
      ctx.lineTo(s * 0.68, s * 0.6);
      ctx.lineTo(s * 0.78, s * 0.92);
      ctx.lineTo(s * 0.5, s * 0.72);
      ctx.lineTo(s * 0.22, s * 0.92);
      ctx.lineTo(s * 0.32, s * 0.6);
      ctx.lineTo(s * 0.05, s * 0.4);
      ctx.lineTo(s * 0.38, s * 0.4);
      ctx.closePath();
      ctx.stroke();
    } else if (kind === "faction") {
      ctx.beginPath();
      ctx.moveTo(s * 0.22, s * 0.12);
      ctx.lineTo(s * 0.22, s * 0.9);
      ctx.moveTo(s * 0.22, s * 0.12);
      ctx.lineTo(s * 0.86, s * 0.3);
      ctx.lineTo(s * 0.22, s * 0.48);
      ctx.stroke();
    } else if (kind === "cash") {
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.26);
      ctx.lineTo(s * 0.5, s * 0.74);
      ctx.moveTo(s * 0.36, s * 0.38);
      ctx.quadraticCurveTo(s * 0.5, s * 0.28, s * 0.64, s * 0.4);
      ctx.moveTo(s * 0.36, s * 0.62);
      ctx.quadraticCurveTo(s * 0.5, s * 0.74, s * 0.64, s * 0.6);
      ctx.stroke();
    } else if (kind === "map") {
      ctx.beginPath();
      ctx.moveTo(s * 0.18, s * 0.28);
      ctx.lineTo(s * 0.42, s * 0.18);
      ctx.lineTo(s * 0.66, s * 0.28);
      ctx.lineTo(s * 0.86, s * 0.18);
      ctx.lineTo(s * 0.86, s * 0.78);
      ctx.lineTo(s * 0.66, s * 0.88);
      ctx.lineTo(s * 0.42, s * 0.78);
      ctx.lineTo(s * 0.18, s * 0.88);
      ctx.closePath();
      ctx.stroke();
    } else if (kind === "match") {
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s / 2, s * 0.08);
      ctx.lineTo(s / 2, s * 0.28);
      ctx.moveTo(s / 2, s * 0.72);
      ctx.lineTo(s / 2, s * 0.92);
      ctx.moveTo(s * 0.08, s / 2);
      ctx.lineTo(s * 0.28, s / 2);
      ctx.moveTo(s * 0.72, s / 2);
      ctx.lineTo(s * 0.92, s / 2);
      ctx.stroke();
    } else if (kind === "kills") {
      ctx.beginPath();
      ctx.moveTo(s * 0.18, s * 0.72);
      ctx.lineTo(s * 0.42, s * 0.28);
      ctx.lineTo(s * 0.5, s * 0.42);
      ctx.lineTo(s * 0.58, s * 0.28);
      ctx.lineTo(s * 0.82, s * 0.72);
      ctx.moveTo(s * 0.28, s * 0.58);
      ctx.lineTo(s * 0.72, s * 0.58);
      ctx.stroke();
    } else if (kind === "rank") {
      ctx.beginPath();
      ctx.moveTo(s * 0.18, s * 0.62);
      ctx.lineTo(s * 0.5, s * 0.28);
      ctx.lineTo(s * 0.82, s * 0.62);
      ctx.moveTo(s * 0.26, s * 0.78);
      ctx.lineTo(s * 0.5, s * 0.52);
      ctx.lineTo(s * 0.74, s * 0.78);
      ctx.stroke();
    } else if (kind === "people") {
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.32, s * 0.16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.86, s * 0.3, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  });
  ctx.restore();
}

export async function renderStatsCard(view) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  await paintScene(ctx, W, H, { blur: 14, dim: 0.22 });

  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, 0, 8, H);

  const name = String(view.name || "Игрок");
  const nameSize = fitName(ctx, name, 760);
  text(ctx, name, 48, 78, { size: nameSize, weight: "800" });

  const tag = String(view.rank?.tagline || "").split("\n");
  tag.forEach((line, i) => {
    text(ctx, line, 860, 48 + i * 34, { size: 28, align: "right", color: WHITE, weight: "600" });
  });

  if (view.live) {
    text(ctx, `сейчас · ${view.live.server} · ${view.live.map || "матч"}`, 48, 112, {
      size: 18,
      color: ORANGE,
    });
  } else {
    text(ctx, view.steamId, 48, 112, { size: 18, color: MUTED, weight: "500" });
  }

  const barX = 48;
  const barY = 148;
  const barW = 800;
  const barH = 16;
  ctx.fillStyle = "#2a261d";
  roundRect(ctx, barX, barY, barW, barH, 8);
  ctx.fill();
  const fill = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  fill.addColorStop(0, "#b45309");
  fill.addColorStop(1, "#fbbf24");
  ctx.fillStyle = fill;
  roundRect(ctx, barX, barY, Math.max(18, barW * (view.rank?.progress || 0)), barH, 8);
  ctx.fill();
  text(ctx, `${(view.rank?.have || 0).toFixed(1)} / ${view.rank?.need || 0} ч`, barX + barW / 2, barY + 13, {
    size: 14,
    align: "center",
    color: "#1a1206",
    weight: "700",
  });
  text(ctx, "Текущий ранг", barX, barY + 42, { size: 16, color: MUTED, weight: "500" });
  text(ctx, "Следующий ранг", barX + barW, barY + 42, { size: 16, color: MUTED, align: "right", weight: "500" });
  text(ctx, view.rank?.name || "Рекрут", barX, barY + 68, { size: 20, color: ORANGE, weight: "700" });
  text(ctx, view.rank?.nextName || view.rank?.name || "—", barX + barW, barY + 68, {
    size: 20,
    color: MUTED,
    align: "right",
  });

  const tiles = [
    ["games", "Всего игр", String(view.games ?? view.matches)],
    ["clock", "Часов у нас", view.hours],
    ["steam", "В WARDOGS", view.steamHours],
    ["wins", "Победы", String(view.wins)],
    ["faction", "Фракция", view.faction],
    ["cash", "Пик кэша", `$${view.cash}`],
    ["map", "Карта", view.map],
    ["match", "Этот матч", view.live ? `${view.live.kills}/${view.live.deaths}` : "не в игре"],
  ];
  tiles.forEach((tile, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const x = 48 + col * 210;
    const y = 258 + row * 90;
    drawIcon(ctx, tile[0], x, y - 16, 22);
    text(ctx, tile[1], x + 32, y, { size: 16, color: MUTED, weight: "500" });
    text(ctx, tile[2], x + 32, y + 36, { size: 28, weight: "700" });
  });

  drawIcon(ctx, "rank", 48, 430, 24);
  text(ctx, view.rank?.name || "Рекрут", 82, 450, { size: 22, color: WHITE, weight: "700" });
  drawIcon(ctx, "faction", 250, 430, 22, MUTED);
  text(ctx, view.faction || "—", 282, 450, { size: 20, color: MUTED });

  const boxes = [
    { x: 48, icon: "wins", title: "Победы", value: `${view.winrate}%`, sub: `K/D  ${view.kd}` },
    { x: 338, icon: "games", title: "Всего игр", value: String(view.games ?? view.matches), sub: `${view.wins} побед` },
    { x: 628, icon: "kills", title: "Всего убийств", value: String(view.kills), sub: `смерти ${view.deaths}` },
  ];
  for (const box of boxes) {
    ctx.fillStyle = "rgba(10, 8, 6, 0.58)";
    roundRect(ctx, box.x, 478, 270, 200, 16);
    ctx.fill();
    drawIcon(ctx, box.icon, box.x + 22, 500, 20);
    text(ctx, box.title, box.x + 50, 518, { size: 18, color: MUTED });
    text(ctx, box.value, box.x + 24, 598, { size: 56, weight: "800" });
    text(ctx, box.sub, box.x + 24, 648, { size: 18, color: MUTED });
  }

  const drawn = await drawAvatar(ctx, view.avatar, 1040, 70, 200);
  if (!drawn) drawInitials(ctx, name, 1040, 70, 200);
  if (!(await drawLogo(ctx, 1088, 430, 250))) {
    drawIcon(ctx, "rank", 1170, 560, 48);
  }
  return canvas.toBuffer("image/png");
}

export async function renderPanelBanner(servers, totals = {}) {
  const width = 1400;
  const height = 320;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  await paintScene(ctx, width, height, { blur: 12, dim: 0.22 });
  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, 0, 8, height);

  const games = Number(totals.games) || 0;
  const players = Number(totals.players) || 0;
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  await drawLogo(ctx, 1240, 24, 110);
  text(ctx, "WARDOGS STATS", 48, 56, { size: 40, weight: "800" });
  text(ctx, `Игр: ${games}   ·   игроков: ${players}   ·   ${clock}`, 48, 92, { size: 18, color: MUTED });

  const list = servers || [];
  list.slice(0, 2).forEach((server, index) => {
    const x = 48 + index * 670;
    const y = 122;
    ctx.fillStyle = "rgba(10, 8, 6, 0.58)";
    roundRect(ctx, x, y, 630, 168, 16);
    ctx.fill();
    ctx.fillStyle = ORANGE;
    roundRect(ctx, x, y, 8, 168, 4);
    ctx.fill();
    text(ctx, server.name || `Сервер ${index + 1}`, x + 28, y + 42, { size: 24, weight: "700" });
    drawIcon(ctx, "people", x + 28, y + 62, 22);
    text(ctx, `${server.online}/${server.max} онлайн`, x + 58, y + 84, { size: 30, color: ORANGE, weight: "800" });
    drawIcon(ctx, "map", x + 28, y + 108, 18, MUTED);
    text(ctx, `${server.map || "карта неизвестна"} · ${server.mode || "матч"} · ${server.matchMin ?? 0}м`, x + 54, y + 126, {
      size: 18,
      color: MUTED,
    });
  });

  if (!list.length) {
    text(ctx, "Серверы ещё не ответили.", 48, 200, { size: 24, color: MUTED });
  }

  return canvas.toBuffer("image/png");
}
