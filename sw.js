const CACHE_NAME = 'hexindo-fleet-v1.1';

// Daftar file sesuai dengan screenshot folder kamu
const urlsToCache = [
  // --- ROOT FILES ---
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',

  // --- CSS FOLDER ---
  './css/all.min.css',
  './css/jetbrain.css',
  './css/rajdhani.css',

  // --- JS FOLDER ---
  './js/chart.js',
  './js/jspdf.plugin.autotable.min.js',
  './js/jspdf.umd.min.js',
  './js/supabase-js@2.js',
  './js/tailwindcss.js',
  './js/xlsx.full.min.js',

  // --- WEBFONTS FOLDER ---
  './webfonts/fa-brands-400.woff2',
  './webfonts/fa-regular-400.woff2',
  './webfonts/fa-solid-900.woff2',
  './webfonts/fa-v4compatibility.woff2',
  './webfonts/JetBrainsMono-Bold.ttf',
  './webfonts/JetBrainsMono-Regular.ttf',
  './webfonts/Rajdhani-Bold.ttf',
  './webfonts/Rajdhani-Medium.ttf',
  './webfonts/Rajdhani-Regular.ttf',

  // --- MECHA VERSION PAGES ---
  './mecha-version/index.html',
  './mecha-version/admin.html',
  './mecha-version/dar.html',
  './mecha-version/login.html',
  './mecha-version/ppu.html',
  './mecha-version/pump-tuning.html',
  './mecha-version/setting.html',
  './mecha-version/toolbox.html',
  
  // --- MINT VERSION PAGES ---
  './mint-version/index.html',
  './mint-version/admin.html',
  './mint-version/dar.html',
  './mint-version/login.html',
  './mint-version/ppu.html',
  './mint-version/pump-tuning.html',
  './mint-version/setting.html',
  './mint-version/toolbox.html'
];

// 1. INSTALL SERVICE WORKER
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. ACTIVATE SERVICE WORKER (Membersihkan Cache Lama)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// 3. FETCH STRATEGY (Network First untuk Supabase, Cache First untuk Aset Lokal)
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Jika request menuju ke API Supabase atau URL eksternal, gunakan NETWORK ONLY
  if (requestUrl.origin !== location.origin) {
    return;
  }

  // Untuk file lokal, gunakan CACHE FIRST, lalu NETWORK
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Jika file ada di cache, kembalikan file tersebut
        if (response) {
          return response;
        }
        // Jika tidak ada, ambil dari jaringan
        return fetch(event.request);
      })
  );
});
