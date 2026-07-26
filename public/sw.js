// Minimal service worker: required by browsers to consider the site
// "installable" as a PWA. Deliberately does no caching so it never
// serves stale data — every request just passes straight through to
// the network, same as if there were no service worker at all.
self.addEventListener("install", function(event){
  self.skipWaiting();
});

self.addEventListener("activate", function(event){
  self.clients.claim();
});

self.addEventListener("fetch", function(event){
  event.respondWith(fetch(event.request));
});
