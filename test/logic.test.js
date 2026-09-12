import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTick,
  detectKillReset,
  detectMatchReset,
  emptyState,
  formatHours,
  isSteamId64,
  kd,
  winningFactions,
} from "../src/logic.js";

const nomad = {
  name: "Nomad",
  steamId: "76561198100000001",
  faction: "Valkyra",
  kills: 5,
  deaths: 2,
  cash: 1200,
};

describe("helpers", () => {
  it("accepts SteamID64", () => {
    assert.equal(isSteamId64("76561198100000001"), true);
    assert.equal(isSteamId64("123"), false);
  });

  it("formats hours", () => {
    assert.equal(formatHours(3661), "1ч 1м");
    assert.equal(formatHours(90), "1м");
  });

  it("computes kd", () => {
    assert.equal(kd(10, 5), 2);
    assert.equal(kd(4, 0), 4);
  });

  it("detects match reset", () => {
    assert.equal(detectMatchReset({ matchSeconds: 400, map: "Kavkazi" }, { matchSeconds: 8, map: "Kavkazi" }), true);
    assert.equal(detectMatchReset({ matchSeconds: 40, map: "Kavkazi" }, { matchSeconds: 44, map: "Kavkazi" }), false);
    assert.equal(detectMatchReset({ matchSeconds: 100, map: "Kavkazi" }, { matchSeconds: 120, map: "Europe" }), true);
    assert.equal(detectMatchReset({ map: "Kavkazi", lighting: "DayClear" }, { map: "Kavkazi", lighting: "Night" }), true);
    assert.equal(detectKillReset([{ kills: 12 }, { kills: 8 }], [{ kills: 0 }, { kills: 1 }]), true);
    assert.equal(detectKillReset([{ kills: 3 }], [{ kills: 4 }, { kills: 2 }]), false);
  });

  it("picks winning factions", () => {
    assert.deepEqual(
      winningFactions([
        { name: "Valkyra", score: 10 },
        { name: "Lonestar", score: 22 },
      ]),
      ["Lonestar"],
    );
  });
});

describe("applyTick", () => {
  it("opens a session and tracks peak cash", () => {
    let state = emptyState();
    const first = applyTick(state, {
      now: 1_000,
      pollMs: 4000,
      status: { map: "Kavkazi", matchSeconds: 80, experiences: ["KOTH"] },
      players: [nomad],
    });
    assert.equal(first.events.some((event) => event.type === "join"), true);
    const second = applyTick(first.state, {
      now: 5_000,
      pollMs: 4000,
      status: { map: "Kavkazi", matchSeconds: 84, experiences: ["KOTH"] },
      players: [{ ...nomad, cash: 2400, kills: 6 }],
    });
    const snap = second.state.match.bySteam.get(nomad.steamId);
    assert.equal(snap.cashPeak, 2400);
    assert.equal(snap.kills, 6);
    assert.equal(second.events.some((event) => event.type === "tick_time"), true);
  });

  it("keeps snapshot after leave and flushes on match reset", () => {
    let state = emptyState();
    state = applyTick(state, {
      now: 1_000,
      pollMs: 4000,
      status: { map: "Kavkazi", matchSeconds: 90, factionScores: [{ name: "Valkyra", score: 11 }] },
      players: [nomad],
    }).state;
    state = applyTick(state, {
      now: 5_000,
      pollMs: 4000,
      status: { map: "Kavkazi", matchSeconds: 94, factionScores: [{ name: "Valkyra", score: 12 }] },
      players: [],
    }).state;
    assert.equal(state.online.size, 0);
    assert.equal(state.match.bySteam.has(nomad.steamId), true);

    const ended = applyTick(state, {
      now: 9_000,
      pollMs: 4000,
      status: { map: "Europe", matchSeconds: 6, factionScores: [] },
      players: [],
    });
    const matchEnd = ended.events.find((event) => event.type === "match_end");
    assert.ok(matchEnd);
    assert.equal(matchEnd.snapshots[0].kills, 5);
    assert.deepEqual(matchEnd.winners, ["Valkyra"]);
  });
});
