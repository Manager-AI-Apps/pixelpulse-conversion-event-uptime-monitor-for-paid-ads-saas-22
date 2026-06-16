/**
 * PixelPulse one-line tracking snippet.
 *
 * Drop this tag onto your site to connect a page to a PixelPulse monitor.
 * The script notifies PixelPulse of page loads so synthetic runs can be
 * initiated from the correct session context.
 *
 * Usage:
 *   <script src="/snippet.js" data-monitor-id="YOUR_MONITOR_ID" async></script>
 *
 * Or declare config in pixelpulse.config.json at the root of your site
 * and omit the data attributes.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var monitorId =
    (script && script.getAttribute("data-monitor-id")) || "";

  if (!monitorId) {
    // Optionally fetched via pixelpulse.config.json when no attribute is set.
    var configUrl =
      (script && script.getAttribute("data-config-url")) ||
      "/pixelpulse.config.json";

    fetch(configUrl)
      .then(function (res) {
        return res.json();
      })
      .then(function (config) {
        if (config && config.monitorId) {
          boot(config.monitorId);
        }
      })
      .catch(function () {
        // Config fetch failed — snippet is a no-op.
      });
    return;
  }

  boot(monitorId);

  function boot(id) {
    if (!id) return;

    // Notify PixelPulse that this page loaded for this monitor.
    // Uses sendBeacon when available (fire-and-forget, survives page unload).
    var endpoint = "https://app.pixelpulse.dev/api/beacon";
    var payload = JSON.stringify({
      monitorId: id,
      url: location.href,
      ts: Date.now(),
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }));
    } else {
      fetch(endpoint, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(function () {});
    }
  }
})();
