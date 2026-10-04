// Jardín de pendientes: funciona sin conexión.
// La página y sus archivos se buscan primero en la red (para recibir mejoras) y, sin conexión, salen de la caché.
const CACHE = "jardin-v20";
const SHELL = ["./", "index.html", "css/app.css", "js/core.js", "js/classify.js", "js/app.js", "config.js", "vendor/supabase-2.117.1.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  // "reload": sin pasar por la caché del navegador (GitHub Pages guarda 10 min), así nunca se guarda el código anterior
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Página principal: red primero, caché si no hay conexión.
  if (req.mode === "navigate") {
    e.respondWith(
      // sin caché del navegador: siempre la versión recién publicada si hay red
      fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./", copy)); return res; })
        .catch(() => caches.match("./").then((r) => r || caches.match("index.html")))
    );
    return;
  }

  // Archivos propios (código, estilos, íconos): red primero, como la página, para que nunca se mezclen versiones.
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin) {
    e.respondWith(fetch(req.url, { cache: "no-cache" }).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }

  // Fuentes: caché primero, y se actualiza en segundo plano.
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!fonts) return;
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    )
  );
});

// Recordatorio diario: llega desde Supabase y se muestra como notificación.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Jardín de pendientes", {
    body: typeof d.body === "string" ? d.body : "",
    icon: "icons/icon-192.png",
    tag: d.tag || "jardin",
    renotify: true,
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow((e.notification.data && e.notification.data.url) || "./");
    })
  );
});
