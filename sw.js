// =====================================================================
// sw.js — 서비스워커 (오프라인 지원, 앱 셸 캐시)
//
// 전략: 앱 셸은 캐시 우선(cache-first) — 설치 시 핵심 파일을 미리 캐시하고,
//       이후 요청은 캐시에서 즉시 응답(없으면 네트워크 → 동일출처면 런타임 캐시).
// 데이터는 localStorage(기기 로컬)에만 있으므로 서비스워커는 정적 파일만 다룬다.
//
// ⚠ 파일을 수정해 재배포할 때는 아래 CACHE 버전을 올려야 새 파일이 반영된다.
// =====================================================================
const CACHE = "loan-app-v1";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/calc.js",
  "./src/model.js",
  "./src/storage.js",
  "./src/agreement-view.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        const url = new URL(req.url);
        if (url.origin === self.location.origin && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
