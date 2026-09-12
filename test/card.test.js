import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeCardFonts, renderStatsCard } from "../src/card.js";

describe("card fonts", () => {
  it("registers a face that can measure cyrillic", () => {
    const fonts = describeCardFonts();
    assert.ok(fonts.registered.length, "no bundled/system fonts registered");
    assert.ok(fonts.ok, `sample width ${fonts.sampleWidth}`);
  });

  it("paints a stats card", async () => {
    const png = await renderStatsCard({
      name: "[STRB] DEMO",
      steamId: "76561198035764252",
      avatar: "",
      kills: 17,
      deaths: 6,
      kd: "2.83",
      hours: "2ч",
      steamHours: "—",
      matches: 3,
      games: 4,
      wins: 1,
      winrate: 33,
      cash: 4200,
      faction: "Valkyra",
      map: "Ozeteti",
      live: { server: "СЕРВЕР 2", map: "Ozeteti", kills: 17, deaths: 6 },
      rank: { name: "Рекрут", nextName: "Боец", tagline: "Первые шаги.", have: 1.7, need: 2, progress: 0.8 },
    });
    assert.ok(png.length > 20_000);
  });
});
