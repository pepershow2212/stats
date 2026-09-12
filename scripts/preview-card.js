import { mkdir, writeFile } from "node:fs/promises";
import { renderPanelBanner, renderStatsCard } from "../src/card.js";

const view = {
  name: "STRB DEMO",
  steamId: "76561198035764252",
  avatar: "",
  kills: 12,
  deaths: 7,
  kd: "1.71",
  hours: "1ч 59м",
  steamHours: "—",
  matches: 3,
  games: 4,
  wins: 1,
  winrate: 33,
  cash: 4200,
  faction: "Valkyra",
  map: "Kavkazi",
  live: { server: "СЕРВЕР 1", map: "Kavkazi", kills: 4, deaths: 2 },
  rank: {
    name: "Рекрут",
    nextName: "Боец",
    tagline: "Первые шаги.",
    have: 1.9,
    need: 2,
    progress: 0.95,
  },
};

const outDir = new URL("../data/", import.meta.url);
await mkdir(outDir, { recursive: true });
await writeFile(new URL("preview-card.png", outDir), await renderStatsCard(view));
await writeFile(
  new URL("preview-panel.png", outDir),
  await renderPanelBanner(
    [
      { name: "СЕРВЕР 1", online: 19, max: 32, map: "Zestafona" },
      { name: "СЕРВЕР 2", online: 11, max: 32, map: "Ozeteti" },
    ],
    { games: 41, players: 86 },
  ),
);
console.log("wrote data/preview-card.png and data/preview-panel.png");
