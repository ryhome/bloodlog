/* BloodLog service worker — แก้ VERSION ทุกครั้งที่อัปเดตไฟล์แอป */
const VERSION = 'bloodlog-v14';
const SHELL = ['./', 'index.html', 'app.js', 'parser.js', 'sec.js', 'ocrtools.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
// ไฟล์ OCR ขนาดใหญ่: พยายามเก็บล่วงหน้า แต่ไม่ให้การติดตั้งล้มเหลวถ้าโหลดไม่ครบ
const OCR = ['vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tesseract/lang/eng.traineddata.gz',
  'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await c.addAll(SHELL);
    c.addAll(OCR).catch(() => {});
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());   // เก็บไฟล์ OCR core ตอนใช้ครั้งแรก
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      throw err;
    }
  })());
});
