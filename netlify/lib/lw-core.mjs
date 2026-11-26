// Shared logic for the lw-collect and lw-export Netlify functions. Kept apart so tests can run it under Node
// with an in-memory store. No IP address, user agent or cookie is ever stored.
const EVENT = /^(visit|tool_start|tool_complete|cta(_[a-z0-9]+)?|lead_[a-z0-9_]+|replay|check_[a-z0-9_]+)$/;
const KEEP = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "ref"];

export function dayET(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function clean(raw) {
  let o;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const e = String(o.e || "visit").slice(0, 40);
  if (!EVENT.test(e)) return null;
  const path = String(o.p || "/").replace(/[^\w./-]/g, "").slice(0, 120) || "/";
  let q = "";
  try {
    const u = new URL(String(o.u || ""), "https://x.invalid");
    const kept = new URLSearchParams();
    KEEP.forEach((k) => { const v = u.searchParams.get(k); if (v) kept.set(k, v.slice(0, 100)); });
    q = kept.toString();
  } catch { q = ""; }
  let ref = "";
  try { ref = o.r ? new URL(String(o.r)).hostname.slice(0, 120) : ""; } catch { ref = ""; }
  return { e, p: path, u: path + (q ? "?" + q : ""), r: ref ? "https://" + ref + "/" : "", g: o.g ? 1 : 0,
    t: String(o.t || "").replace(/[^\w-]/g, "").slice(0, 40) };
}

export async function collect(store, body, now = new Date()) {
  const ev = clean(body);
  if (!ev) return false;
  const key = `e/${dayET(now)}/${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
  await store.setJSON(key, ev);
  return true;
}

export async function exportDay(store, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) throw new Error("day must be YYYY-MM-DD");
  const { blobs } = await store.list({ prefix: `e/${day}/` });
  const counts = new Map();
  for (const b of blobs) {
    const ev = await store.get(b.key, { type: "json" });
    if (!ev) continue;
    const k = JSON.stringify([ev.e, ev.p, ev.u, ev.r, ev.g, ev.t]);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const rows = [...counts.entries()].map(([k, n]) => { const [e, p, u, r, g, t] = JSON.parse(k); return { e, p, u, r, g, t, count: n }; });
  return { day, rows };
}
