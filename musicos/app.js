
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { initializeFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = s => document.querySelector(s);
const MUSICOS_INSTALLED_KEY = "egp-musicos-installed";
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
const installDialog = $("#installDialog");
let deferredPrompt = null;
let songs = new Map();

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = /android/i.test(navigator.userAgent);

function esc(value=""){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function showInstall(){installView.hidden=false;appView.hidden=true;}
function showApp(){installView.hidden=true;appView.hidden=false;startApp();}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.disabled = false;
  installBtn.textContent = "Instalar app";
  installHint.textContent = "";
});

window.addEventListener("appinstalled", () => {
  localStorage.setItem(MUSICOS_INSTALLED_KEY,"1");
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
    installHint.textContent = "Safari necesita estos dos pasos.";
    return;
  }
  if (standalone) { showApp(); return; }
  installHint.textContent = isAndroid
    ? "Abre este QR con Chrome para instalar la app."
    : "En el menú del navegador elige Instalar aplicación.";
});

$("#closeDialog").addEventListener("click",()=>installDialog.close());

async function startApp(){
  if (startApp.started) return; startApp.started=true;
  try {
    const [cfgRes,songsRes] = await Promise.all([
      fetch("../configuracion.json",{cache:"no-store"}),
      fetch("../canciones.json",{cache:"no-store"})
    ]);
    const cfg = await cfgRes.json();
    const list = await songsRes.json();
    songs = new Map(list.map(song=>[String(song.id),song]));
    const firebase = initializeApp(cfg.firebase,"egp-musicos");
    const db = initializeFirestore(firebase,{experimentalAutoDetectLongPolling:true,useFetchStreams:false});
    onSnapshot(doc(db,"config","estado"), snapshot => {
      connectionDot.classList.add("online");
      render(snapshot.exists()?snapshot.data():{});
    }, error => {
      console.error(error);
      connectionDot.classList.remove("online");
    });
  } catch(error) {
    console.error(error);
    venueName.textContent="Sin conexión";
    connectionDot.classList.remove("online");
  }
}

function render(data){
  const active = data.show_activo === true;
  const venue = String(data.lugar||"").trim();
  venueName.textContent = active ? (venue || "Show activo") : "No hay show activo";
  const ids = active && Array.isArray(data.cola) ? data.cola.map(String) : [];
  const playedIds = new Set(Array.isArray(data.tocadas)?data.tocadas.map(String):[]);
  const queueItems = ids.map((id,originalIndex)=>({id,song:songs.get(id),originalIndex,played:playedIds.has(id)})).filter(item=>item.song);
  const items = [...queueItems.filter(item=>!item.played),...queueItems.filter(item=>item.played)];
  queueCount.textContent = `${items.length} ${items.length===1?"canción":"canciones"}`;
  const firstActiveIndex=items.findIndex(item=>!item.played);
  queueList.innerHTML = items.map((item,index)=>{
    const song=item.song;
    const number = String(song.numero || song.n || item.originalIndex+1).padStart(2,"0");
    const isNext=index===firstActiveIndex&&!item.played;
    return `<article class="song-card ${isNext?"next":""} ${item.played?"played":""}">
      <div class="song-number">${esc(number)}</div>
      <div>
        ${isNext?'<div class="song-label">Sigue</div>':item.played?'<div class="song-label played-label">Tocada</div>':''}
        <div class="song-title">${esc(song.titulo||"Sin título")}</div>
        <div class="song-artist">${esc(song.artista||"")}</div>
      </div>
    </article>`;
  }).join("");
  queueList.hidden = items.length===0;
  emptyState.hidden = items.length>0;
  emptyState.textContent = active ? "No hay canciones en cola" : "No hay show activo";
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js",{scope:"./",updateViaCache:"none"}).catch(console.warn));
}

if (standalone && localStorage.getItem(MUSICOS_INSTALLED_KEY)==="1") showApp(); else {
  showInstall();
  if (isiOS) { installBtn.textContent="Cómo instalar"; installHint.textContent="Sigue los tres pasos mostrados abajo."; iosHelp.hidden=false; }
  else if(standalone){ installBtn.textContent="Abrir en navegador para instalar"; installBtn.disabled=false; installHint.textContent="La abrió la app del panel. Ábrela en el navegador para instalar EGP MUSICOS con su propio icono."; installBtn.addEventListener("click",()=>window.open(location.href.replace(/[?&]source=pwa/,""),"_blank"),{once:true}); }
  else { installBtn.disabled=false; installHint.textContent=""; }
}
