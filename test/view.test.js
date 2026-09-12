import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildView, rankFromHours } from "../src/view.js";

describe("rankFromHours", () => {
  it("starts as recruit", () => {
    const rank = rankFromHours(0);
    assert.equal(rank.name, "Рекрут");
    assert.equal(rank.nextName, "Боец");
    assert.equal(rank.progress, 0);
  });

  it("fills toward veteran", () => {
    const rank = rankFromHours(6 * 3600);
    assert.equal(rank.name, "Боец");
    assert.equal(rank.nextName, "Ветеран");
    assert.ok(rank.progress > 0.4 && rank.progress < 0.6);
  });
});

describe("buildView", () => {
  it("adds live match kills onto lifetime", () => {
    const player = {
      steam_id: "76561198100000001",
      name: "Nomad",
      kills: 10,
      deaths: 4,
      wins: 2,
      matches: 5,
      seconds_played: 3600,
      steam_minutes: 0,
      cash_peak_best: 900,
      last_faction: "Valkyra",
      avatar: "",
      vac_banned: 0,
    };
    const store = { extras: () => ({ factions: [], maps: [{ map: "Kavkazi" }], mates: [] }) };
    const poller = {
      snapshot: () => ({
        status: { map: "Kavkazi" },
        roster: [{ steamId: player.steam_id, kills: 3, deaths: 1, cash: 200, faction: "Valkyra" }],
      }),
    };
    const view = buildView(store, poller, [{ id: "1", name: "СЕРВЕР 1" }], player);
    assert.equal(view.kills, 13);
    assert.equal(view.deaths, 5);
    assert.equal(view.live.kills, 3);
    assert.equal(view.games, 6);
    assert.equal(view.winrate, 40);
    assert.equal(view.rank.name, "Рекрут");
  });
});
