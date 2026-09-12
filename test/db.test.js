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

  it("builds a saved top 100 from finished matches", () => {
    const store = openDb(":memory:");
    const now = Date.now();
    for (let i = 1; i <= 12; i++) {
      const steamId = `765611981000000${String(i).padStart(2, "0")}`;
      store.touchPlayer("1", { steamId, name: `P${i}`, faction: "Valkyra" }, now);
      store.recordMatch("1", {
        steamId,
        name: `P${i}`,
        faction: "Valkyra",
        kills: 20 - i,
        deaths: 2,
        cashEnd: 100,
        cashPeak: 100,
      }, {
        map: "Kavkazi",
        mode: "KOTH",
        startedAt: now - 1000,
        endedAt: now,
        winners: i === 1 ? ["Valkyra"] : [],
      });
    }
    const rows = store.top("kills", 100);
    assert.equal(rows.length, 12);
    assert.equal(rows[0].name, "P1");
    assert.equal(rows[0].kills, 19);
    assert.equal(rows[1].kills, 18);
    const boardId = store.saveBoard(rows, { reason: "prize", frozen: 1 });
    const saved = store.latestBoard();
    assert.equal(saved.id, boardId);
    assert.equal(saved.frozen, 1);
    assert.equal(saved.rows[0].name, "P1");
    assert.equal(saved.rows.length, 12);
    store.close();
  });
});
