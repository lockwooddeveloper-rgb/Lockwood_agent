// GET /.netlify/functions/lw-export?day=YYYY-MM-DD   Authorization: Bearer <LW_ANALYTICS_TOKEN>
// Daily counts for Lockwood GTM to pull. Set LW_ANALYTICS_TOKEN in Netlify (Site configuration > Environment
// variables) to the same value as in GTM's .env. Without it, every request is refused.
import { getStore } from "../lib/blobs.mjs";
import { exportDay } from "../lib/lw-core.mjs";

export default async (req) => {
  const token = (globalThis.Netlify && Netlify.env.get("LW_ANALYTICS_TOKEN")) || process.env.LW_ANALYTICS_TOKEN || "";
  const auth = req.headers.get("authorization") || "";
  if (!token || auth !== `Bearer ${token}`) return new Response("forbidden", { status: 403 });
  const day = new URL(req.url).searchParams.get("day");
  try {
    return Response.json(await exportDay(getStore("lw-events"), day));
  } catch (e) {
    return new Response(String(e.message || e), { status: 400 });
  }
};
