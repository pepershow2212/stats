import { Agent, fetch as undiciFetch } from "undici";

const insecure = new Agent({
  connect: { rejectUnauthorized: false },
});

const schemeCache = new Map();

function cacheKey(server) {
  return `${server.host}:${server.port}`;
}

function errorDetail(text) {
  if (!text) return "";
  try {
    const body = JSON.parse(text);
    return body?.error?.message || body?.error?.code || text.slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
}

async function request(server, path, scheme, timeoutMs, options = {}) {
  const { method = "GET", body, raw, headers = {} } = options;
  const payload = raw != null ? raw : body != null ? JSON.stringify(body) : undefined;
  const url = `${scheme}://${server.host}:${server.port}${path}`;
  const response = await undiciFetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${server.password}`,
      ...(payload != null && raw == null ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: payload,
    signal: AbortSignal.timeout(timeoutMs),
    dispatcher: scheme === "https" ? insecure : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    const detail = errorDetail(text);
    throw new Error(`RCON ${response.status} ${method} ${path}${detail ? `: ${detail}` : ""}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export async function rconCall(server, path, options = {}) {
  const key = cacheKey(server);
  const remote = server.host && server.host !== "127.0.0.1" && server.host !== "localhost";
  const preferred = schemeCache.get(key) || (server.tls || remote ? "https" : "http");
  const order = preferred === "https" ? ["https", "http"] : ["http", "https"];
  let lastError;
  for (const scheme of order) {
    try {
      const body = await request(server, path, scheme, options.timeoutMs || 8000, options);
      schemeCache.set(key, scheme);
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function rconGet(server, path, timeoutMs = 8000) {
  return rconCall(server, path, { method: "GET", timeoutMs });
}

function reservedIdsFromConfig(text) {
  return [...String(text || "").matchAll(/^\s*\+DefaultReservedPlayerIds=(\d+)/gm)].map((row) => row[1]);
}

function applyReservedIds(text, keepIds) {
  const keep = [...new Set((keepIds || []).map(String).filter(Boolean))];
  const lines = String(text || "").split(/\r?\n/);
  const without = lines.filter((line) => !/^\s*\+DefaultReservedPlayerIds=/.test(line));
  const extra = keep.map((id) => `+DefaultReservedPlayerIds=${id}`);
  const at = without.findIndex((line) => /^\s*MaxReservedSlots=/.test(line));
  if (at >= 0) without.splice(at + 1, 0, ...extra);
  else without.push(...extra);
  return without.join("\n");
}

async function writeReservedViaConfig(server, keepIds) {
  const doc = await rconGet(server, "/v1/config", 6000);
  const next = applyReservedIds(doc?.text || "", keepIds);
  const revision = doc?.revision ? `"${doc.revision}"` : undefined;
  await rconCall(server, "/v1/config", {
    method: "PUT",
    raw: next,
    timeoutMs: 6000,
    headers: {
      "content-type": "text/plain",
      ...(revision ? { "If-Match": revision } : {}),
    },
  });
}

export async function listReservedSlots(server) {
  const body = await rconGet(server, "/v1/reserved-slots", 5000);
  const ids = body?.reservedSlots || body?.steamIds || [];
  return (Array.isArray(ids) ? ids : []).map(String);
}

export async function addReservedSlot(server, steamId) {
  const want = String(steamId);
  const bodies = [{ steamId: want }, { steamID: want }, { steam_id: want }];
  for (const body of bodies) {
    try {
      await rconCall(server, "/v1/reserved-slots", { method: "POST", body, timeoutMs: 5000 });
      console.log(`reserve POST ok ${server.name} ${want}`);
      return {};
    } catch (error) {
      if (/RCON 409|already|exists|duplicate/i.test(String(error.message))) return {};
      console.warn("reserve POST", server.name, error instanceof Error ? error.message : error);
    }
  }
  await writeReservedViaConfig(server, [want]);
  console.log(`reserve config ${server.name} ${want}`);
  return {};
}

export async function dropReservedSlot(server, steamId) {
  const want = String(steamId);
  try {
    await rconCall(server, `/v1/reserved-slots/${want}`, { method: "DELETE", timeoutMs: 5000 });
    return {};
  } catch (error) {
    if (/RCON 404/i.test(String(error.message))) return {};
    console.warn("reserve DELETE", server.name, error instanceof Error ? error.message : error);
  }
  const ids = await listReservedSlots(server).catch(() => []);
  if (!ids.includes(want)) return {};
  await writeReservedViaConfig(server, ids.filter((id) => id !== want));
  return {};
}

export async function fetchSnapshot(server) {
  const [status, playersBody] = await Promise.all([
    rconGet(server, "/v1/status"),
    rconGet(server, "/v1/players"),
  ]);
  return {
    status,
    players: Array.isArray(playersBody?.players) ? playersBody.players : [],
  };
}
