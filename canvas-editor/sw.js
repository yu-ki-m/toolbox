/**
 * Canvas Editor のサービスワーカー。
 *
 * base path（/toolbox/canvas-editor/ または ./）に依存しないよう、スコープは
 * self.registration.scope から取得する。ビルド毎に変わるハッシュ付きアセット名を
 * 事前列挙できないため、プリキャッシュは最小限（アプリシェル）にとどめ、実体は
 * ランタイムキャッシュで賄う。
 *
 * - ナビゲーション(HTML): ネットワーク優先 → オフライン時はキャッシュのアプリシェル
 * - その他の同一オリジン GET: stale-while-revalidate
 *
 * キャッシュを意図的に破棄したいときは CACHE_VERSION を上げる。
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `canvas-editor-${CACHE_VERSION}`;
const CACHE_PREFIX = 'canvas-editor-';

const SCOPE_URL = new URL(self.registration.scope);
const APP_SHELL_URL = SCOPE_URL.href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        await cache.add(new Request(APP_SHELL_URL, { cache: 'reload' }));
      } catch {
        // 初回がオフラインなど取得失敗時は無視する（後続のfetchで補完される）。
      }

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 同一オリジンかつスコープ配下のみ扱い、外部(CDN等)やリポジトリ取得は素通しする。
  if (url.origin !== SCOPE_URL.origin || !url.pathname.startsWith(SCOPE_URL.pathname)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  event.respondWith(handleAssetRequest(request));
});

async function handleNavigationRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    cache.put(APP_SHELL_URL, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match(APP_SHELL_URL));

    if (cached) {
      return cached;
    }

    return Response.error();
  }
}

async function handleAssetRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone());
      }

      return response;
    })
    .catch(() => undefined);

  return cached || (await network) || Response.error();
}
