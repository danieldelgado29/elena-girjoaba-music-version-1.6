"use strict";
const CACHE="egp-musicos-v1.1.1";
const CORE=["./","./index.html","./style.css","./app.js","./manifest.webmanifest","./icon-192.png","./icon-512.png","./apple-touch-icon.png","../configuracion.json","../canciones.json"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;const url=new URL(event.request.url);if(event.request.mode==="navigate"){event.respondWith(fetch(event.request).catch(()=>caches.match("./index.html")));return;}event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(url.origin===location.origin){const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}return response;})));});
