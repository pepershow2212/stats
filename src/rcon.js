import { Agent, fetch as undiciFetch } from "undici";

const insecure = new Agent({
  connect: { rejectUnauthorized: false },
});

const schemeCache = new Map();

function cacheKey(server) {
  return `${server.host}:${server.port}`;
}

async function request(server, path, scheme, timeoutMs, { method = "GET", body } = {}) {
  const url = `${scheme}://${server.host}:${server.port}${path}`;
  const response = await undiciFetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${server.password}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    dispatcher: scheme === "https" ? insecure : undefined,
  });
  if (!response.ok) {
    throw new Error(`RCON ${response.status} ${method} ${path}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
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

export async function addReservedSlot(server, steamId) {
  return rconCall(server, "/v1/reserved-slots", { method: "POST", body: { steamId } });
}

export async function dropReservedSlot(server, steamId) {
  return rconCall(server, `/v1/reserved-slots/${steamId}`, { method: "DELETE" });
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
