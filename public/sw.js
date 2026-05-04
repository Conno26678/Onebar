// Service Worker for Onebar - Basic caching strategy
const CACHE_NAME = 'onebar-v1';
const urlsToCache = [
  '/',
  '/css/theme.css',
  '/css/mobile.css',
  '/css/index.css',
  '/css/lobby.css',
  '/css/game.css',
  '/css/profile.css',
  '/css/about.css',
  '/css/leaderboard.css',
  '/css/battlepass.css',
  '/css/room.css',
  '/css/cards-atlas.css',
  '/js/lobby.js',
  '/js/room.js',
  '/js/theme.js',
  '/img/ONElogo.png'
];

// Install event - cache essential files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.log('Cache install error:', err))
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip socket.io requests
  if (event.request.url.includes('socket.io')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // Clone the request
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then(response => {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response
          const responseToCache = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });

          return response;
        });
      })
      .catch(() => {
        // If both cache and network fail, show offline page
        return caches.match('/');
      })
  );
});
