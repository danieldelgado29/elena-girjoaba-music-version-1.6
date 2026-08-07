import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { initializeFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = selector => document.querySelector(selector);
const installView = $("#installView");
const appView = $("#appView");
const installBtn = $("#installBtn");
const installHint = $("#installHint");
const iosHelp = $("#iosHelp");
const venueName = $("#venueName");
const queueCount = $("#queueCount");
const queueList = $("#queueList");
const emptyState = $("#emptyState");
const connectionDot = $("#connectionDot");
const appError = $("#appError");
const installDialog = $("#installDialog");

let deferredPrompt = null;
let songs = new Map();
let unsubscribe = null;

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = /android/i.test(navigator.userAgent);

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function showInstall() {
  installView.hidden = false;
  appView.hidden = true;
}

function showApp() {
  installView.hidden = true;
  appView.hidden = false;
  startApp();
}

function showError(message) {
  appView.hidden = false;
  appError.hidden = false;
  appError.textContent = message;
  connectionDot.classList.remove("online");
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.disabled = false;
  installBtn.textContent = "Instalar app";
  installHint.textContent = "";
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  installBtn.textContent = "App instalada";
  installHint.textContent = "Ábrela desde el icono EGP MUSICOS.";
});

installBtn.addEventListener("click", async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    return;
  }

  if (isiOS) {
    iosHelp.hidden = false;
    installHint.textContent = "Sigue los tres pasos mostrados abajo.";
    return;
  }

  if (standalone) {
    showApp();
    return;
  }

  installHint.textContent = isAndroid
    ? "Abre esta dirección en Chrome y usa Instalar app en el menú del navegador."
    : "Usa la opción Instalar aplicación del navegador.";
});

$("#closeDialog")?.addEventListener("click", () => installDialog.close());

async function startApp() {
  if (startApp.started) return;
  startApp.started = true;
  appError.hidden = true;

  try {
    const [cfgRes, songsRes] = await Promise.all([
      fetch("../configuracion.json", { cache: "no-store" }),
      fetch("../canciones.json", { cache: "no-store" })
    ]);

    if (!cfgRes.ok || !songsRes.ok) {
      throw new Error(`No se pudieron cargar los datos base (${cfgRes.status}/${songsRes.status}).`);
    }

    const cfg = await cfgRes.json();
    const list = await songsRes.json();
    if (!cfg?.firebase || !Array.isArray(list)) throw new Error("Configuración incompleta.");

    songs = new Map(list.map(song => [String(song.id), song]));
    const firebase = initializeApp(cfg.firebase, "egp-musicos");
    const db = initializeFirestore(firebase, {
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: false
    });

    unsubscribe?.();
    unsubscribe = onSnapshot(doc(db, "config", "estado"), snapshot => {
      connectionDot.classList.add("online");
      appError.hidden = true;
      render(snapshot.exists() ? snapshot.data() : {});
    }, error => {
      console.error(error);
      showError("No se pudo conectar con la cola. Revisa el internet y vuelve a abrir la app.");
    });
  } catch (error) {
    console.error(error);
    venueName.textContent = "Sin conexión";
    emptyState.hidden = false;
    emptyState.textContent = "No se pudo cargar la app";
    showError("No se pudo iniciar EGP MUSICOS. Recarga la página cuando tengas conexión.");
  }
}

function render(data) {
  const active = data.show_activo === true;
  const venue = String(data.lugar || "").trim();
  venueName.textContent = active ? (venue || "Show activo") : "No hay show activo";

  const ids = active && Array.isArray(data.cola) ? data.cola.map(String) : [];
  const playedIds = new Set(Array.isArray(data.tocadas) ? data.tocadas.map(String) : []);
  const queueItems = ids
    .map((id, originalIndex) => ({ id, song: songs.get(id), originalIndex, played: playedIds.has(id) }))
    .filter(item => item.song);
  const items = [...queueItems.filter(item => !item.played), ...queueItems.filter(item => item.played)];

  queueCount.textContent = `${items.length} ${items.length === 1 ? "canción" : "canciones"}`;
  const firstActiveIndex = items.findIndex(item => !item.played);
  queueList.innerHTML = items.map((item, index) => {
    const song = item.song;
    const number = String(song.numero || song.n || item.originalIndex + 1).padStart(2, "0");
    const isNext = index === firstActiveIndex && !item.played;
    return `<article class="song-card ${isNext ? "next" : ""} ${item.played ? "played" : ""}">
      <div class="song-number">${esc(number)}</div>
      <div>
        ${isNext ? '<div class="song-label">Sigue</div>' : item.played ? '<div class="song-label played-label">Tocada</div>' : ""}
        <div class="song-title">${esc(song.titulo || "Sin título")}</div>
        <div class="song-artist">${esc(song.artista || "")}</div>
      </div>
    </article>`;
  }).join("");

  queueList.hidden = items.length === 0;
  emptyState.hidden = items.length > 0;
  emptyState.textContent = active ? "No hay canciones en cola" : "No hay show activo";
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js?v=1.1.2", {
        scope: "./",
        updateViaCache: "none"
      });
      await registration.update();
    } catch (error) {
      console.warn("Service Worker músicos:", error);
    }
  });
}

// Una PWA instalada siempre entra directamente a la cola.
// No depende de localStorage ni del evento appinstalled, que iOS no garantiza.
if (standalone) {
  showApp();
} else {
  showInstall();
  if (isiOS) {
    installBtn.textContent = "Cómo instalar";
    installHint.textContent = "Sigue los tres pasos mostrados abajo.";
    iosHelp.hidden = false;
  } else {
    installBtn.disabled = false;
    installHint.textContent = "";
  }
}
