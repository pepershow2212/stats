import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyReservedIds } from "../src/rcon.js";
import { parseVipMessage, vipDaysFromAmount } from "../src/vip.js";

describe("reserved slots merge", () => {
  it("keeps multiple ids and raises MaxReservedSlots", () => {
    const ini = `[/Script/WDGame.WDGameSession]
MaxReservedSlots=20
.DefaultReservedPlayerIds=76561198000000001
`;
    const next = applyReservedIds(ini, ["76561198000000001", "76561198000000002"], { minSlots: 55 });
    assert.match(next, /MaxReservedSlots=55/);
    assert.match(next, /DefaultReservedPlayerIds=76561198000000001/);
    assert.match(next, /DefaultReservedPlayerIds=76561198000000002/);
    assert.match(next, /!DefaultReservedPlayerIds=ClearArray/);
  });
});

describe("vip message parse", () => {
  it("reads steam and discord from donation message", () => {
    assert.deepEqual(parseVipMessage("vip pls 76561198345678901"), {
      steamId: "76561198345678901",
      discordId: "",
    });
    assert.equal(parseVipMessage("<@123456789012345678> VIP").discordId, "123456789012345678");
    assert.equal(parseVipMessage("discord 123456789012345678").discordId, "123456789012345678");
  });
});

describe("max reserved slots parse", () => {
  it("reads MaxReservedSlots from ini", async () => {
    const { maxReservedSlotsFromConfig } = await import("../src/rcon.js");
    assert.equal(maxReservedSlotsFromConfig("MaxReservedSlots=100\n"), 100);
    assert.equal(maxReservedSlotsFromConfig("foo"), 0);
  });
});

describe("vip days from amount", () => {
  it("maps rub packs to days", () => {
    assert.equal(vipDaysFromAmount(100, "RUB"), 0);
    assert.equal(vipDaysFromAmount(299, "RUB"), 30);
    assert.equal(vipDaysFromAmount(598, "RUB"), 60);
    assert.equal(vipDaysFromAmount(299, "USD"), 0);
  });
});
