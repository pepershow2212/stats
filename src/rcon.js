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
  const preferred = schemeCache.get(key) || (server.tls ? "https" : "http");
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
  return [...String(text || "").matchAll(/^\s*[+.]DefaultReservedPlayerIds=(\d+)/gm)].map((row) => row[1]);
}

function applyReservedIds(text, keepIds) {
  const keep = [...new Set((keepIds || []).map(String).filter(Boolean))];
  const lines = String(text || "").split(/\r?\n/).map((line) =>
    line.replace(/^(\s*ScorePeriod=)(\d+)/, (_, prefix, value) => {
      const n = Number(value);
      return n >= 18 && n <= 30 ? `${prefix}${n}` : `${prefix}30`;
    }),
  );
  const without = lines.filter((line) => !/^\s*[+!.]?DefaultReservedPlayerIds=/.test(line));
  const extra = ["!DefaultReservedPlayerIds=ClearArray", ...keep.map((id) => `.DefaultReservedPlayerIds=${id}`)];
  const max = without.findIndex((line) => /^\s*MaxReservedSlots=/.test(line));
  const session = without.findIndex((line) => /\[\/Script\/WDGame\.WDGameSession\]/.test(line));
  if (max >= 0) without.splice(max, 0, ...extra);
  else if (session >= 0) without.splice(session + 1, 0, ...extra);
  else without.push("[/Script/WDGame.WDGameSession]", ...extra);
  return without.join("\n");
}

async function writeReservedViaConfig(server, keepIds) {
  const doc = await rconGet(server, "/v1/config", 8000);
  const next = applyReservedIds(doc?.text || "", keepIds);
  await rconCall(server, "/v1/config?force=true", {
    method: "PUT",
    raw: next,
    timeoutMs: 15000,
    headers: {
      "content-type": "text/plain",
    },
  });
}

export async function listReservedSlots(server) {
  try {
    const body = await rconGet(server, "/v1/reserved-slots", 5000);
    const ids = body?.reservedSlots || body?.steamIds || [];
    if (Array.isArray(ids)) return ids.map(String);
  } catch {
    // fallback below
  }
  const doc = await rconGet(server, "/v1/config", 8000);
  return reservedIdsFromConfig(doc?.text || "");
}

export async function addReservedSlot(server, steamId) {
  const want = String(steamId);
  const already = await listReservedSlots(server).catch(() => []);
  if (already.includes(want)) return {};
  await writeReservedViaConfig(server, [want]);
  const after = await listReservedSlots(server).catch(() => []);
  if (!after.includes(want)) throw new Error(`слот не записался на ${server.name}`);
  console.log(`reserve ok ${server.name} ${want}`);
  return {};
}

export async function dropReservedSlot(server, steamId) {
  const want = String(steamId);
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
