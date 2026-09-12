import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatHours, formatKd } from "./logic.js";

export const TOP_LIMIT = 100;

export function stamp(at = Date.now()) {
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n;]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function formatTopCsv(rows, { metric = "kills", at = Date.now() } = {}) {
  const header = "place,name,steamid,kills,deaths,kd,wins,matches,hours";
  const lines = (rows || []).map((row, index) =>
    [
      index + 1,
      csvCell(row.name),
      row.steam_id,
      row.kills || 0,
      row.deaths || 0,
      formatKd(row.kills, row.deaths),
      row.wins || 0,
      row.matches || 0,
      (Math.max(0, Number(row.seconds_played) || 0) / 3600).toFixed(2),
    ].join(","),
  );
  return `\uFEFF# топ ${rows.length} · ${metric} · ${stamp(at)}\n${header}\n${lines.join("\n")}\n`;
}

export function formatTopLine(row, index, metric) {
  const place = String(index + 1).padStart(2, "0");
  const value = {
    kills: `**${row.kills}** · ${formatKd(row.kills, row.deaths)}`,
    deaths: String(row.deaths),
    hours: formatHours(row.seconds_played),
    cash: `$${row.cash_peak_best}`,
    wins: `**${row.wins}** / ${row.matches}`,
    matches: `**${row.matches}** игр · ${row.wins} побед`,
    kd: `**${formatKd(row.kills, row.deaths)}** · ${row.kills}/${row.deaths}`,
  }[metric] || `**${row.kills}**`;
  return `\`${place}\`  **${row.name}**  —  ${value}`;
}

export function persistTop100(store, dir, { reason = "auto", frozen = false, metric = "kills", serverId = "" } = {}) {
  const rows = store.top(metric, TOP_LIMIT, serverId);
  if (!rows.length) return { rows: [], file: null, boardId: null };
  const boardId = store.saveBoard(rows, { reason, frozen: frozen ? 1 : 0 });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, frozen ? `prize-top100-${Date.now()}.csv` : "top100.csv");
  writeFileSync(file, formatTopCsv(rows, { metric }));
  return { rows, file, boardId };
}
