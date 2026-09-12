import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Cooldown } from "../src/cooldown.js";

describe("Cooldown", () => {
  it("blocks for one minute then opens", () => {
    let now = 1_000_000;
    const cd = new Cooldown(60_000, () => now);
    assert.equal(cd.remaining("u"), 0);
    cd.hit("u");
    now += 20_000;
    assert.equal(cd.remaining("u"), 40_000);
    now += 40_000;
    assert.equal(cd.remaining("u"), 0);
  });
});
