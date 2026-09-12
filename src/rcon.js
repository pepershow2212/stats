import { Agent, fetch as undiciFetch } from "undici";

const insecure = new Agent({
  connect: { rejectUnauthorized: false },
});

const schemeCache = new Map();

function cacheKey(server) {
  return `${server.host}:${server.port}`;
}

async function request(server, path, scheme, timeoutMs) {
  const url = `${scheme}://${server.host}:${server.port}${path}`;
  const response = await undiciFetch(url, {
    headers: { Authorization: `Bearer ${server.password}` },
    signal: AbortSignal.timeout(timeoutMs),
    dispatcher: scheme === "https" ? insecure : undefined,
  });
  if (!response.ok) {
    throw new Error(`RCON ${response.status} ${path}`);
  }
  return response.json();
}

export async function rconGet(server, path, timeoutMs = 8000) {
  const key = cacheKey(server);
  const preferred = schemeCache.get(key) || (server.tls ? "https" : "http");
  const order = preferred === "https" ? ["https", "http"] : ["http", "https"];
  let lastError;
  for (const scheme of order) {
    try {
      const body = await request(server, path, scheme, timeoutMs);
      schemeCache.set(key, scheme);
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
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
