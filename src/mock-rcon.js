import { createServer } from "node:http";

const Factions = [
  { name: "Valkyra", colorHex: "#D86060", score: 12 },
  { name: "Lonestar", colorHex: "#5B95D8", score: 9 },
  { name: "Manticore", colorHex: "#7BC462", score: 14 },
];

const roster = [
  { name: "Nomad", steamId: "76561198100000001", faction: "Valkyra", kills: 4, deaths: 2, cash: 2100, pingMs: 28 },
  { name: "QuietStorm", steamId: "76561198100000002", faction: "Lonestar", kills: 3, deaths: 1, cash: 1800, pingMs: 35 },
  { name: "Ghostpepper", steamId: "76561198100000003", faction: "Manticore", kills: 6, deaths: 3, cash: 3400, pingMs: 22 },
  { name: "Willowisp", steamId: "76561198100000004", faction: "Lonestar", kills: 1, deaths: 4, cash: 900, pingMs: 61 },
];

let matchSeconds = 80;
let mapIndex = 0;
const maps = ["Kavkazi", "Europe", "NorthAmerica"];

function tickWorld() {
  matchSeconds += 4;
  if (matchSeconds > 180) {
    matchSeconds = 8;
    mapIndex = (mapIndex + 1) % maps.length;
    for (const player of roster) {
      player.kills = 0;
      player.deaths = 0;
      player.cash = 400;
    }
    for (const faction of Factions) faction.score = 0;
  }
  const player = roster[Math.floor(Math.random() * roster.length)];
  if (Math.random() < 0.6) {
    player.kills += 1;
    player.cash += 250 + Math.floor(Math.random() * 400);
    const team = Factions.find((row) => row.name === player.faction);
    if (team) team.score += 1;
  } else {
    player.deaths += 1;
  }
}

export function startMockRcon(port = 7776) {
  const timer = setInterval(tickWorld, 4000);
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || "";
    if (auth !== "Bearer demo") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "unauthorized", message: "bad token" } }));
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let body = {};
    if (url.pathname === "/v1/status") {
      body = {
        serverName: "Wardogs Demo",
        map: maps[mapIndex],
        experiences: ["Bakurani_KOTH_01"],
        lighting: "DayClear",
        alternator: "ZoneAlternator.Factory.Circle",
        scoreTick: { current: 24, min: 18, max: 30 },
        scoreCap: 100,
        matchSeconds,
        players: { current: roster.length, max: 100 },
        factionScores: Factions,
        rotation: { nowIndex: mapIndex, nextIndex: (mapIndex + 1) % maps.length },
      };
    } else if (url.pathname === "/v1/players") {
      body = { players: roster };
    } else {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: url.pathname } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.log(`mock RCON http://127.0.0.1:${port}  token=demo`);
      resolve({
        close() {
          clearInterval(timer);
          return new Promise((done) => server.close(done));
        },
      });
    });
  });
}
