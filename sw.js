/* bobolog service worker — เลขเวอร์ชันอยู่ใน version.js (แก้ที่นั่นทุกครั้งที่อัปเดตไฟล์แอป) */
importScripts('version.js');            // ได้ค่า APP_VERSION — เบราว์เซอร์ตรวจไฟล์นี้ด้วยเวลาเช็กอัปเดต
const VERSION = 'bloodlog-' + APP_VERSION;       // คำนำหน้าแคชคงเป็น bloodlog (ชื่อเดิมของแอป) — เปลี่ยนแล้วไม่ได้ประโยชน์
const SHELL = ['./', 'index.html', 'version.js', 'app.js', 'parser.js', 'sec.js', 'ocrtools.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
// ไฟล์ OCR ขนาดใหญ่: พยายามเก็บล่วงหน้า แต่ไม่ให้การติดตั้งล้มเหลวถ้าโหลดไม่ครบ
const OCR = ['vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tesseract/lang/eng.traineddata.gz', 'vendor/tesseract/lang/tha.traineddata.gz',
  'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    // cache:'reload' = ข้ามแคช HTTP ของเบราว์เซอร์ ไม่อย่างนั้นถ้าเครื่องเพิ่งโหลดไฟล์ชุดเก่ามาไม่กี่นาทีก่อน
    // (GitHub Pages ให้เก็บได้ 10 นาที) แคชของเวอร์ชันใหม่จะถูกเติมด้วยไฟล์เก่า แล้วค้างอยู่อย่างนั้น
    const fresh = list => list.map(u => new Request(u, { cache: 'reload' }));
    await c.addAll(fresh(SHELL));
    c.addAll(fresh(OCR)).catch(() => {});
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
      const res = await fetch(req, { cache: 'no-cache' });   // ถามเซิร์ฟเวอร์เสมอว่าไฟล์เปลี่ยนหรือยัง
      if (res.ok) cache.put(req, res.clone());   // เก็บไฟล์ OCR core ตอนใช้ครั้งแรก
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      throw err;
    }
  })());
});
