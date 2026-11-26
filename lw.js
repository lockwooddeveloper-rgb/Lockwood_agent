/* Lockwood cookie-free counter. No cookies, no storage, no visitor id, no IP kept.
   Sends: the event name, the page path, utm tags or ?ref, the referring site's host, and a tool name.
   <script src="/lw.js" data-endpoint="/.netlify/functions/lw-collect" defer></script>
   window.lw.track("tool_complete", {tool: "asset-vs-stock"}) for conversions. */
(function () {
  var s = document.currentScript, ep = (s && s.dataset.endpoint) || "/.netlify/functions/lw-collect";
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") { window.lw = { track: function () {} }; return; }
  if (/bot|crawl|spider|slurp|headless|lighthouse/i.test(navigator.userAgent || "")) { window.lw = { track: function () {} }; return; }
  var q = new URLSearchParams(location.search);
  function send(e, extra) {
    var body = JSON.stringify({ e: e, p: location.pathname, u: location.pathname + location.search,
      r: document.referrer || "", g: q.get("gclid") ? 1 : 0, t: (extra && extra.tool) || "" });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(ep, new Blob([body], { type: "text/plain" }));
      else fetch(ep, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } });
    } catch (x) {}
  }
  window.lw = { track: send };
  send("visit");
})();
