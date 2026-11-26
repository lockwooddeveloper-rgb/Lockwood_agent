// POST /.netlify/functions/lw-collect   body: the small JSON event from /lw.js
// Stores one tiny record per event in Netlify Blobs. Never stores the IP address or user agent.
import { getStore } from "../lib/blobs.mjs";
import { collect } from "../lib/lw-core.mjs";

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview/i;

export default async (req) => {
  if (req.method !== "POST") return new Response("", { status: 405 });
  if (BOT.test(req.headers.get("user-agent") || "")) return new Response("", { status: 204 });
  const text = (await req.text()).slice(0, 2000);
  await collect(getStore("lw-events"), text);
  return new Response("", { status: 204 });
};
