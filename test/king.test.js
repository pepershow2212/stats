import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kingWeekKey, moscowParts } from "../src/king.js";

describe("king week", () => {
  it("starts Friday 18:00 Moscow", () => {
    const fridayEvening = Date.parse("2026-09-11T15:00:00Z");
    const fridayAfternoon = Date.parse("2026-09-11T14:00:00Z");
    const saturday = Date.parse("2026-09-12T12:00:00Z");
    assert.equal(moscowParts(fridayEvening).weekday, 5);
    assert.equal(kingWeekKey(fridayEvening), "2026-09-11");
    assert.equal(kingWeekKey(fridayAfternoon), "2026-09-04");
    assert.equal(kingWeekKey(saturday), "2026-09-11");
  });
});
