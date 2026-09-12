import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommunityXml } from "../src/steam.js";

describe("parseCommunityXml", () => {
  it("reads cdata avatar and name", () => {
    const parsed = parseCommunityXml(`
      <profile>
        <steamID><![CDATA[[STRB] DEMO]]></steamID>
        <avatarFull><![CDATA[https://avatars.steamstatic.com/abc_full.jpg]]></avatarFull>
      </profile>
    `);
    assert.equal(parsed.name, "[STRB] DEMO");
    assert.equal(parsed.avatar, "https://avatars.steamstatic.com/abc_full.jpg");
  });
});
