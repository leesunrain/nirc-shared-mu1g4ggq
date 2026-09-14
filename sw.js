/* 말하는 가계부 업데이트 서비스워커 — 사용자 화면에는 버전을 표시하지 않습니다. */
const BUILD_ID = '20260914-stable-update';
const APP_CACHE_PREFIX = 'talking-ledger-';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 이 앱 이름으로 만든 과거 캐시만 정리합니다. IndexedDB 가계부 기록은 삭제하지 않습니다.
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(APP_CACHE_PREFIX)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 같은 주소에서 업데이트했을 때 구버전 HTML/JS/CSS가 남지 않도록 항상 네트워크 최신본을 요청합니다.
  event.respondWith((async () => {
    try {
      return await fetch(req, { cache: 'no-store' });
    } catch (err) {
      // 네트워크 장애 시 브라우저 자체 오류 응답으로 넘깁니다. 사용자 데이터는 로컬 DB에 그대로 있습니다.
      return Response.error();
    }
  })());
});
