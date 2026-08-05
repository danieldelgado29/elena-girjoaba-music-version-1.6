(() => {
  "use strict";

  const APP_VERSION = "6.36.71.1";
  const VERSION_URL = "./version.json";
  const UPDATE_INTERVAL = 5 * 60 * 1000;
  let targetVersion = APP_VERSION;
  let registrationRef = null;
  let reloading = false;


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

  function requestActivation(worker) {
    if (!worker) return;
    worker.postMessage({ type: "SKIP_WAITING" });
  }

  async function readRemoteVersion() {
    if (!navigator.onLine) return APP_VERSION;
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" }
    });
    if (!response.ok) throw new Error(`Version HTTP ${response.status}`);
    const info = await response.json();
    return String(info.version || APP_VERSION);
  }

  async function checkForUpdate() {
    if (!registrationRef || !navigator.onLine) return;
    try {
      targetVersion = await readRemoteVersion();
      await registrationRef.update();
      if (registrationRef.waiting) requestActivation(registrationRef.waiting);
    } catch (error) {
      console.warn("No se pudo comprobar la actualización", error);
    }
  }

  window.addEventListener("offline", showConnectionStatus);
  window.addEventListener("online", () => {
    showConnectionStatus();
    checkForUpdate();
  });
  if (!navigator.onLine) window.addEventListener("DOMContentLoaded", showConnectionStatus, { once: true });

  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    const url = new URL(location.href);
    url.searchParams.set("appv", targetVersion || Date.now().toString());
    location.replace(url.href);
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", {
        scope: "./",
        updateViaCache: "none"
      });
      registrationRef = registration;

      if (registration.waiting) requestActivation(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            requestActivation(worker);
          }
        });
      });

      await checkForUpdate();
      window.addEventListener("focus", checkForUpdate);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
      setInterval(checkForUpdate, UPDATE_INTERVAL);
    } catch (error) {
      console.warn("No se pudo activar el modo offline", error);
    }
  });
})();
