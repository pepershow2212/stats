import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb } from "../src/db.js";

describe("store", () => {
  it("accumulates match stats once", () => {
    const store = openDb(":memory:");
    const now = Date.now();
    store.touchPlayer("1", {
      steamId: "76561198100000001",
      name: "Nomad",
      faction: "Valkyra",
    }, now);
    store.recordMatch("1", {
      steamId: "76561198100000001",
      name: "Nomad",
      faction: "Valkyra",
      kills: 7,
      deaths: 3,
      cashEnd: 900,
      cashPeak: 2200,
    }, {
      map: "Kavkazi",
      mode: "KOTH",
      startedAt: now - 1000,
      endedAt: now,
      winners: ["Valkyra"],
    });
    const player = store.player("76561198100000001");
    assert.equal(player.kills, 7);
    assert.equal(player.wins, 1);
    assert.equal(player.matches, 1);
    assert.equal(player.cash_peak_best, 2200);
    store.link("111", "76561198100000001", now);
    assert.equal(store.linkForDiscord("111").steam_id, "76561198100000001");
    const totals = store.totals();
    assert.equal(totals.games, 1);
    assert.equal(totals.players, 1);
    store.close();
  });
});
