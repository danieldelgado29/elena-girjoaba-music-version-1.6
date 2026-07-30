(() => {
  "use strict";

  function showConnectionStatus() {
    let banner = document.getElementById("pwaConnectionStatus");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "pwaConnectionStatus";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      Object.assign(banner.style, {
        position: "fixed", left: "50%", bottom: "14px", zIndex: "99999",
        transform: "translateX(-50%)", padding: "8px 13px", borderRadius: "999px",
        font: "600 12px/1.2 system-ui, sans-serif", color: "#fff",
        background: "rgba(15,16,19,.94)", border: "1px solid rgba(255,255,255,.18)",
        boxShadow: "0 8px 30px rgba(0,0,0,.35)", transition: "opacity .25s ease",
        pointerEvents: "none"
      });
      document.body.appendChild(banner);
    }
    banner.textContent = navigator.onLine ? "Conexión restablecida" : "Sin conexión · modo offline";
    banner.style.opacity = "1";
    clearTimeout(showConnectionStatus.timer);
    if (navigator.onLine) showConnectionStatus.timer = setTimeout(() => banner.style.opacity = "0", 2400);
  }

  window.addEventListener("offline", showConnectionStatus);
  window.addEventListener("online", showConnectionStatus);
  if (!navigator.onLine) window.addEventListener("DOMContentLoaded", showConnectionStatus, { once: true });

  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", {
        scope: "./",
        updateViaCache: "none"
      });

      const activateUpdate = worker => {
        if (worker?.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      };

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => activateUpdate(worker));
      });

      const checkUpdate = () => {
        if (navigator.onLine) registration.update().catch(() => {});
      };
      checkUpdate();
      window.addEventListener("online", checkUpdate);
      window.addEventListener("focus", checkUpdate);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkUpdate();
      });
      setInterval(checkUpdate, 30 * 60 * 1000);

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
    } catch (error) {
      console.warn("No se pudo activar el modo offline", error);
    }
  });
})();
