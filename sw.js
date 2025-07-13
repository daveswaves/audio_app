// sw.js
const VERSION = 1;
// const VERSION = '2025.06.01';
const CACHE_NAME = `audio-book-app-v${VERSION}`;

self.addEventListener('install', (e) => {
  // console.log('Service Worker: Installed');
});

self.addEventListener('activate', (e) => {
  // console.log('Service Worker: Activated');
});

/* self.addEventListener('fetch', (e) => {
  // Just let the request pass through
  // console.log('Service Worker: Fetching', e.request.url);
}); */
