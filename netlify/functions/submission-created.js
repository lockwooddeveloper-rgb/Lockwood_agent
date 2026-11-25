// Runs on every verified Netlify Forms submission (Netlify calls a function with this exact
// name automatically). Sends the checklist to people who ask for it, and a notice to us for
// every form. Uses Resend's HTTP API with built-in fetch, so there are no packages to install.
//
// Netlify environment variables:
//   RESEND_API_KEY   required. Without it this function does nothing (and the site still works).
//   MAIL_FROM        e.g. "Abraham Ramsey <abraham@meetlockwood.com>" (domain must be verified in Resend)
//   NOTIFY_TO        where lead notices go, e.g. abraham@meetlockwood.com
//   SITE_URL         default https://meetlockwood.com
//   POSTAL_ADDRESS   optional, added to the checklist email footer

const CHECKLIST_PATH = "/checklist/lockwood-seller-tax-checklist.pdf";
const LABELS = { name: "Name", email: "Email", plan: "Request", price: "Price", role: "Role", size: "Revenue",
  loi: "Deal status", timing: "Sale timing", check_score: "Check score", check_range: "Check range",
  check_issues: "Check issues", from: "From", page: "Page", ref: "Source", campaign: "Campaign", created: "Sent" };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || "").trim());

function checklistEmail(site, address) {
  const link = site + CHECKLIST_PATH;
  const text = [
    "Hi,",
    "",
    "Here's the seller's tax checklist you asked for:",
    link,
    "",
    "It covers what a buyer's tax review looks at and what to gather before you list.",
    "",
    "If you want to see where your own records stand, the free readiness check is at " + site + "/#check",
    "",
    "Abraham Ramsey",
    "Lockwood",
    "",
    "You're getting this because you asked for the checklist at meetlockwood.com. Reply \"stop\" and we won't email you again.",
    address ? address : "",
  ].join("\n").trim();
  const html = "<div style=\"font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#13201f\">" +
    "<p>Hi,</p><p>Here's the seller's tax checklist you asked for:<br><a href=\"" + esc(link) + "\">Download the checklist (PDF)</a></p>" +
    "<p>It covers what a buyer's tax review looks at and what to gather before you list.</p>" +
    "<p>If you want to see where your own records stand, the free readiness check is at <a href=\"" + esc(site) + "/#check\">meetlockwood.com</a>.</p>" +
    "<p>Abraham Ramsey<br>Lockwood</p>" +
    "<p style=\"font-size:12px;color:#66726f\">You're getting this because you asked for the checklist at meetlockwood.com. Reply \"stop\" and we won't email you again." +
    (address ? "<br>" + esc(address) : "") + "</p></div>";
  return { subject: "Your seller's tax checklist from Lockwood", text, html };
}

function noticeEmail(form, data) {
  const who = data.name || data.email || "someone";
  const subject = (form === "updates" ? "Checklist sign-up: " : "New " + (data.plan || "lead") + " request: ") + who;
  const rows = Object.keys(LABELS).filter((k) => data[k] !== undefined && String(data[k]).trim() !== "");
  const text = rows.map((k) => LABELS[k] + ": " + data[k]).join("\n");
  const html = "<table style=\"font-family:Arial,sans-serif;font-size:14px\">" +
    rows.map((k) => "<tr><td style=\"color:#66726f;padding:3px 14px 3px 0\">" + LABELS[k] + "</td><td>" + esc(data[k]) + "</td></tr>").join("") +
    "</table><p style=\"font-family:Arial,sans-serif;font-size:12px;color:#66726f\">Reply to this email to reach them.</p>";
  return { subject, text, html };
}

async function sendMail(key, msg) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  });
  if (!res.ok) throw new Error("Resend " + res.status + ": " + (await res.text()).slice(0, 300));
  return res.json();
}

exports.handler = async (event) => {
  const env = process.env;
  let payload;
  try { payload = JSON.parse(event.body || "{}").payload || {}; } catch (e) { return { statusCode: 400, body: "bad payload" }; }
  const form = payload.form_name || "";
  const data = payload.data || {};
  if (data["bot-field"]) return { statusCode: 200, body: "ignored" };
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) { console.log("submission-created: RESEND_API_KEY or MAIL_FROM not set, skipping", form); return { statusCode: 200, body: "not configured" }; }

  const site = (env.SITE_URL || "https://meetlockwood.com").replace(/\/$/, "");
  const replyTo = env.NOTIFY_TO || undefined;
  const jobs = [];

  if (form === "updates" && validEmail(data.email)) {
    const m = checklistEmail(site, env.POSTAL_ADDRESS || "");
    jobs.push(sendMail(env.RESEND_API_KEY, { from: env.MAIL_FROM, to: [String(data.email).trim()], reply_to: replyTo, ...m }));
  }
  if (env.NOTIFY_TO && (form === "updates" || form === "lead")) {
    const m = noticeEmail(form, data);
    jobs.push(sendMail(env.RESEND_API_KEY, { from: env.MAIL_FROM, to: [env.NOTIFY_TO], reply_to: validEmail(data.email) ? String(data.email).trim() : undefined, ...m }));
  }

  const results = await Promise.allSettled(jobs);
  results.forEach((r) => { if (r.status === "rejected") console.error("submission-created:", r.reason && r.reason.message); });
  return { statusCode: 200, body: "sent " + results.filter((r) => r.status === "fulfilled").length + "/" + results.length };
};

exports._test = { checklistEmail, noticeEmail };
