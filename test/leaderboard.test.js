import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTopCsv } from "../src/leaderboard.js";

describe("leaderboard csv", () => {
  it("keeps steam ids for prize payouts", () => {
    const csv = formatTopCsv([
      {
        name: "[STRB] DEMO",
        steam_id: "76561198035764252",
        kills: 12,
        deaths: 4,
        wins: 1,
        matches: 3,
        seconds_played: 7200,
      },
    ]);
    assert.match(csv, /76561198035764252/);
    assert.match(csv, /\[STRB\] DEMO/);
    assert.match(csv, /place,name,steamid/);
  });
});
