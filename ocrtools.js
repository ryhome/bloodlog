/* bobolog — เครื่องมือเตรียมรูปก่อน OCR (ครอบตัด หมุน ลดเงา) และอ่านข้อความจากไฟล์ PDF
   ทุกอย่างทำในเครื่อง ไลบรารี pdf.js อยู่ใน vendor/pdfjs/ */
'use strict';

const OcrTools = (() => {
  const MAX = 3000;      // ด้านยาวสุดของรูปที่เก็บไว้ทำงาน (px)

  async function loadImage(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); if (bmp.close) bmp.close();
    return c;
  }

  /** วาดรูปต้นทางลงผืนผ้าใบขนาด W×H โดยหมุน rot90×90° + fine องศา รอบจุดกึ่งกลาง (พื้นหลังขาว) */
  function drawRotated(ctx, src, W, H, rot90, fine) {
    const odd = rot90 % 2 === 1, s = W / (odd ? src.height : src.width);
    ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2); ctx.rotate((rot90 * 90 + fine) * Math.PI / 180);
    ctx.drawImage(src, -src.width * s / 2, -src.height * s / 2, src.width * s, src.height * s);
    ctx.restore();
  }

  /** ลดเงาและเพิ่มความคมชัด: ประมาณความสว่างของ "กระดาษ" ในแต่ละบริเวณ แล้วหารออก ทำให้พื้นขาวสม่ำเสมอ ตัวหนังสือเข้ม */
  function enhance(canvas) {
    const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h), d = img.data, gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const B = Math.max(16, Math.round(Math.max(w, h) / 60)), sw = Math.ceil(w / B), sh = Math.ceil(h / B);
    const small = document.createElement('canvas'); small.width = sw; small.height = sh;
    const sctx = small.getContext('2d'), simg = sctx.createImageData(sw, sh);
    for (let by = 0; by < sh; by++) for (let bx = 0; bx < sw; bx++) {
      const hist = new Uint16Array(256); let n = 0;
      for (let y = by * B, ye = Math.min(h, y + B); y < ye; y += 2) for (let x = bx * B, xe = Math.min(w, x + B); x < xe; x += 2) { hist[gray[y * w + x]]++; n++; }
      let acc = 0, v = 255; const cut = n * 0.1;                     // ค่าที่สว่างกว่า 90% ของบล็อก ≈ สีกระดาษ (ไม่สนแสงสะท้อนจุดเล็ก ๆ)
      for (; v > 0; v--) { acc += hist[v]; if (acc >= cut) break; }
      const o = (by * sw + bx) * 4; simg.data[o] = simg.data[o + 1] = simg.data[o + 2] = v; simg.data[o + 3] = 255;
    }
    sctx.putImageData(simg, 0, 0);
    const bgc = document.createElement('canvas'); bgc.width = w; bgc.height = h;
    const bctx = bgc.getContext('2d', { willReadFrequently: true }); bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(small, 0, 0, sw, sh, 0, 0, sw * B, sh * B);        // ขยายกลับแบบเกลี่ย = ภาพความสว่างพื้นหลัง
    const bg = bctx.getImageData(0, 0, w, h).data;
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
      const b = bg[i];
      if (b < 45) { d[i] = d[i + 1] = d[i + 2] = 255; continue; }     // มืดมากทั้งบริเวณ = พื้นโต๊ะสีดำ ไม่ใช่กระดาษ → ปล่อยเป็นพื้นขาว
      const r = gray[j] / b;                                          // 1 = สีกระดาษ, ต่ำ = หมึก
      const v = r >= 0.9 ? 255 : Math.max(0, (r - 0.25) / 0.65 * 255);
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /* กรอบครอบเป็นสี่เหลี่ยม 4 มุมอิสระ เรียง [บนซ้าย, บนขวา, ล่างขวา, ล่างซ้าย] พิกัดเป็นสัดส่วน 0..1 */
  const rectToQuad = r => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
  const DEF_QUAD = () => rectToQuad({ x0: 0.04, y0: 0.04, x1: 0.96, y1: 0.96 });
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const convex = q => [0, 1, 2, 3].every(i => cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]) > 1e-5);
  const inside = (q, p) => [0, 1, 2, 3].every(i => cross(q[i], q[(i + 1) % 4], p) >= 0);
  const area = q => Math.abs(q.reduce((s, p, i) => s + p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y, 0)) / 2;
  const isAxisRect = q => Math.abs(q[0].y - q[1].y) < 1e-3 && Math.abs(q[3].y - q[2].y) < 1e-3 && Math.abs(q[0].x - q[3].x) < 1e-3 && Math.abs(q[1].x - q[2].x) < 1e-3;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /** หามุมกระดาษทั้ง 4 (เมื่อกระดาษสีต่างจากพื้นหลังและอยู่ในรูปครบทั้งแผ่น) คืน { pts, persp } หรือ null ถ้าไม่มั่นใจ
      วิธี: ใช้สีที่ขอบรูปเป็นตัวแทน "พื้นหลัง" → จุดที่สีต่างจากพื้นหลังมาก = กระดาษ → เอามุมสุดทั้ง 4 ทิศเฉียง
      persp = กระดาษเป็นสี่เหลี่ยมคางหมูชัดเจน (ถ่ายเฉียง) */
  function detectQuad(src, rot90) {
    const c = rotCopy(src, rot90, 360), w = c.width, h = c.height, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const m = Math.max(2, Math.round(Math.min(w, h) * 0.03)), ring = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < m || y < m || x >= w - m || y >= h - m) ring.push((y * w + x) * 4);
    const med = ch => { const a = ring.map(i => d[i + ch]).sort((p, q) => p - q); return a[a.length >> 1]; };
    const br = med(0), bg = med(1), bb = med(2), dd = i => Math.hypot(d[i] - br, d[i + 1] - bg, d[i + 2] - bb);
    const rd = ring.map(dd).sort((p, q) => p - q), p90 = rd[Math.floor(rd.length * 0.9)];
    if (p90 > 45) return null;                                        // ขอบรูปไม่ใช่สีเดียวกัน (กระดาษล้นขอบรูป หรือพื้นหลังรก): ไม่เดา
    const thr = Math.max(30, p90 * 2.2), mask = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < mask.length; i += 4, j++) mask[j] = dd(i) > thr ? 1 : 0;
    // เก็บเฉพาะก้อนที่ใหญ่พอ (ตัดจุดรบกวนบนโต๊ะ)
    const lab = new Int32Array(w * h), keep = [], stack = [];
    for (let s0 = 0, id = 0; s0 < mask.length; s0++) {
      if (!mask[s0] || lab[s0]) continue;
      id++; let n = 0; stack.push(s0); lab[s0] = id;
      while (stack.length) { const k = stack.pop(), x = k % w, y = (k - x) / w; n++;
        if (x > 0 && mask[k - 1] && !lab[k - 1]) { lab[k - 1] = id; stack.push(k - 1); }
        if (x < w - 1 && mask[k + 1] && !lab[k + 1]) { lab[k + 1] = id; stack.push(k + 1); }
        if (y > 0 && mask[k - w] && !lab[k - w]) { lab[k - w] = id; stack.push(k - w); }
        if (y < h - 1 && mask[k + w] && !lab[k + w]) { lab[k + w] = id; stack.push(k + w); } }
      if (n > w * h * 0.015) keep.push(id);
    }
    if (!keep.length) return null;
    const ok = new Set(keep); let tl, tr, brr, bl, total = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!ok.has(lab[y * w + x])) continue; total++;
      if (!tl || x + y < tl.x + tl.y) tl = { x, y }; if (!brr || x + y > brr.x + brr.y) brr = { x, y };
      if (!tr || x - y > tr.x - tr.y) tr = { x, y }; if (!bl || x - y < bl.x - bl.y) bl = { x, y };
    }
    const px = [tl, tr, brr, bl], q = px.map(p => ({ x: (p.x + 0.5) / w, y: (p.y + 0.5) / h }));
    if (!convex(q)) return null;
    const A = area(q); if (A < 0.12 || A > 0.96) return null;
    if (q.some(p => p.x < 0.012 || p.y < 0.012 || p.x > 0.988 || p.y > 0.988)) return null;        // มุมชนขอบรูป = กระดาษถูกตัด มุมที่ได้ไม่ใช่มุมจริง
    let inQ = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ok.has(lab[y * w + x]) && inside(q, { x: (x + 0.5) / w, y: (y + 0.5) / h })) inQ++;
    if (inQ / (A * w * h) < 0.6 || (total - inQ) / total > 0.15) return null;                      // รูปร่างที่เจอไม่ใช่สี่เหลี่ยมผืนเดียว
    const top = dist(q[0], q[1]) * w, bot = dist(q[3], q[2]) * w, lef = dist(q[0], q[3]) * h, rig = dist(q[1], q[2]) * h;   // ความยาวด้านเป็นพิกเซลจริง
    const persp = Math.max(Math.abs(1 - top / bot), Math.abs(1 - lef / rig)) > 0.06;
    const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    return { pts: q.map(p => ({ x: p.x + (cx - p.x) * 0.015, y: p.y + (cy - p.y) * 0.015 })), persp };      // หดเข้าเล็กน้อย ตัดขอบกระดาษ/เงาขอบทิ้ง
  }

  /** ดึงบริเวณ 4 มุม (พิกัดพิกเซลบน full) ให้เป็นสี่เหลี่ยมขนาด outW×outH ด้วย homography + bilinear */
  function warp(full, q, outW, outH) {
    const dst = [[0, 0], [outW, 0], [outW, outH], [0, outH]], M = [];
    for (let i = 0; i < 4; i++) { const [X, Y] = dst[i], { x, y } = q[i]; M.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y, x], [0, 0, 0, X, Y, 1, -y * X, -y * Y, y]); }
    for (let cI = 0; cI < 8; cI++) {                                  // Gaussian elimination (8 สมการ 8 ตัวแปร)
      let piv = cI; for (let r = cI + 1; r < 8; r++) if (Math.abs(M[r][cI]) > Math.abs(M[piv][cI])) piv = r;
      [M[cI], M[piv]] = [M[piv], M[cI]];
      const pv = M[cI][cI] || 1e-12; for (let k = cI; k < 9; k++) M[cI][k] /= pv;
      for (let r = 0; r < 8; r++) if (r !== cI) { const f = M[r][cI]; if (f) for (let k = cI; k < 9; k++) M[r][k] -= f * M[cI][k]; }
    }
    const H = M.map(r => r[8]), sw = full.width, sh = full.height;
    const sd = full.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    const out = document.createElement('canvas'); out.width = outW; out.height = outH;
    const octx = out.getContext('2d', { willReadFrequently: true }), oimg = octx.createImageData(outW, outH), od = oimg.data;
    for (let y = 0, o = 0; y < outH; y++) for (let x = 0; x < outW; x++, o += 4) {
      const den = H[6] * x + H[7] * y + 1, fx = (H[0] * x + H[1] * y + H[2]) / den, fy = (H[3] * x + H[4] * y + H[5]) / den;
      od[o + 3] = 255;
      if (!(fx >= 0 && fy >= 0 && fx < sw - 1 && fy < sh - 1)) { od[o] = od[o + 1] = od[o + 2] = 255; continue; }
      const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, i = (y0 * sw + x0) * 4, i2 = i + sw * 4;
      for (let ch = 0; ch < 3; ch++) od[o + ch] = (sd[i + ch] * (1 - ax) + sd[i + 4 + ch] * ax) * (1 - ay) + (sd[i2 + ch] * (1 - ax) + sd[i2 + 4 + ch] * ax) * ay;
    }
    octx.putImageData(oimg, 0, 0);
    return out;
  }

  /** สำเนารูปที่หมุน rot90×90° แล้วย่อให้ด้านยาวไม่เกิน maxSide */
  function rotCopy(src, rot90, maxSide, fine = 0) {
    const ww = rot90 % 2 ? src.height : src.width, wh = rot90 % 2 ? src.width : src.height, k = Math.min(1, maxSide / Math.max(ww, wh));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(ww * k)); c.height = Math.max(1, Math.round(wh * k));
    drawRotated(c.getContext('2d', { willReadFrequently: true }), src, c.width, c.height, rot90, fine);
    return c;
  }

  /** หาบริเวณที่มีตัวหนังสือ/ขอบกระดาษ คืนกรอบแบบสัดส่วน 0..1 (ในพิกัดหลังหมุน rot90) หรือ null ถ้าไม่มั่นใจ
      วิธี: ย่อรูป → ลดเงา (พื้นโต๊ะและกระดาษกลายเป็นขาว เหลือ "หมึก" เป็นสีเข้ม) → นับหมึกรายแถว/รายคอลัมน์ → เอาช่วงที่มีหมึก
      ออกแบบให้พลาดไปทาง "ครอบกว้างเกิน" เสมอ: สิ่งรบกวนบนพื้นหลังทำให้กรอบใหญ่ขึ้น ไม่ได้ทำให้ตัดข้อมูลทิ้ง */
  function detectRect(src, rot90, fine = 0) {
    const c = enhance(rotCopy(src, rot90, 480, fine)), w = c.width, h = c.height;
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const col = new Float32Array(w), row = new Float32Array(h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] < 128) { col[x]++; row[y]++; }
    const span = (arr, other) => {
      const thr = Math.max(1.5, other * 0.006), m = Math.max(1, Math.round(arr.length * 0.01)); let a = -1, b = -1;
      for (let i = m; i < arr.length - m; i++) {
        let sum = 0, n = 0; for (let j = Math.max(0, i - 2); j <= Math.min(arr.length - 1, i + 2); j++) { sum += arr[j]; n++; }
        if (sum / n > thr) { if (a < 0) a = i; b = i; }
      }
      return a < 0 ? null : [a / arr.length, (b + 1) / arr.length];
    };
    const sx = span(col, h), sy = span(row, w);
    if (!sx || !sy) return null;
    const PAD = 0.03, r = { x0: Math.max(0, sx[0] - PAD), y0: Math.max(0, sy[0] - PAD), x1: Math.min(1, sx[1] + PAD), y1: Math.min(1, sy[1] + PAD) };
    if (r.x1 - r.x0 < 0.15 || r.y1 - r.y0 < 0.15) return null;                 // เล็กผิดปกติ: น่าจะจับผิด
    if (r.x1 - r.x0 > 0.97 && r.y1 - r.y0 > 0.97) return null;                 // เกือบเต็มรูปอยู่แล้ว
    return r;
  }

  /** หามุมเอียงเล็กน้อย (±10°) ที่ทำให้บรรทัดตัวหนังสือขนานแนวนอนที่สุด คืนมุมที่ต้องหมุนแก้ (องศา) หรือ 0 ถ้าไม่ชัดเจน
      วิธี: ลองหมุนรูปย่อทีละมุม แล้ววัดว่า "หมึกรายแถว" แยกเป็นแถว/ช่องว่างชัดแค่ไหน — บรรทัดตรง = แถวที่มีหมึกกับแถวว่างต่างกันมากที่สุด */
  function detectSkew(src, rot90) {
    const base = enhance(rotCopy(src, rot90, 420)), w = base.width, h = base.height;
    const t = document.createElement('canvas'); t.width = w; t.height = h; const tctx = t.getContext('2d', { willReadFrequently: true });
    const x0 = Math.round(w * 0.12), x1 = Math.round(w * 0.88), y0 = Math.round(h * 0.12), y1 = Math.round(h * 0.88);   // ใช้เฉพาะตรงกลาง: มุมรูปที่หมุนแล้วเป็นพื้นขาวเปล่า
    const score = ang => {
      drawRotated(tctx, base, w, h, 0, ang);
      const d = tctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, rw = x1 - x0; let sum = 0, sq = 0, n = 0;
      for (let y = 0; y < y1 - y0; y++) { let c = 0; for (let x = 0; x < rw; x++) if (d[(y * rw + x) * 4] < 128) c++; sum += c; sq += c * c; n++; }
      return sq / n - (sum / n) ** 2;                                 // ความแปรปรวนของจำนวนหมึกต่อแถว
    };
    const zero = score(0); let best = 0, bs = zero;
    for (let a = -10; a <= 10; a++) { if (!a) continue; const v = score(a); if (v > bs) { bs = v; best = a; } }
    for (const a of [best - 0.5, best + 0.5]) { const v = score(a); if (v > bs) { bs = v; best = a; } }
    return best !== 0 && bs > zero * 1.25 ? best : 0;                 // ต้องดีกว่ามุมเดิมชัดเจนจึงจะแก้
  }

  /** เลือกทิศที่ตัวหนังสืออ่านออก: ลองอ่านแบบเร็วทีละทิศ (เริ่มจากทิศเดิม) หยุดทันทีที่เจอทิศที่อ่านได้ดี
      quick(canvas) → Promise<{text, conf}>, stop() → true ถ้าผู้ใช้ลงมือปรับเองแล้ว (ให้เลิกทำงาน) */
  async function detectRotation(src, quick, stop) {
    let best = { rot: 0, score: -1 };
    for (const rot of [0, 1, 3, 2]) {
      if (stop()) return null;
      const r = detectRect(src, rot) || { x0: 0, y0: 0, x1: 1, y1: 1 }, full = rotCopy(src, rot, 1400);
      const x = Math.round(r.x0 * full.width), y = Math.round(r.y0 * full.height), w = Math.max(8, Math.round((r.x1 - r.x0) * full.width)), h = Math.max(8, Math.round((r.y1 - r.y0) * full.height));
      const k = Math.min(1, 1000 / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d', { willReadFrequently: true }).drawImage(full, x, y, w, h, 0, 0, c.width, c.height);
      const { text, conf } = await quick(enhance(c));
      // หลักฐานว่ารูปตั้งตรง แบบไม่ขึ้นกับภาษา: ตัวเลขที่อ่านออกเป็นตัว ๆ, หน่วย (mg/dL, %), และคำอังกฤษ
      const nums = (text.match(/(?<![\w.,])\d{1,3}(?:,\d{3})*(?:\.\d+)?(?![\w.,])/g) || []).length;
      const units = (text.match(/mg\/d[lL]|g\/d[lL]|U\/L|mmol|%/g) || []).length, eng = (text.match(/[A-Za-z]{4,}/g) || []).length;
      const words = eng + nums + 2 * units, score = conf * Math.min(words, 80);
      if (score > best.score) best = { rot, score, conf, words };
      if (conf >= 60 && (eng >= 6 || nums + units >= 10)) break;                 // อ่านได้ดีแล้ว ไม่ต้องลองทิศที่เหลือ
    }
    return best.score > 0 && best.conf >= 30 && best.words >= 4 ? best.rot : null;   // ไม่มีทิศไหนอ่านออก: ไม่เดา
  }

  /** เปิดหน้าครอบตัด คืน canvas ที่พร้อมส่ง OCR หรือ null ถ้ายกเลิก
      quick: ตัวอ่านแบบเร็วสำหรับหาทิศของรูป (ไม่ให้มา = ไม่หมุนอัตโนมัติ ครอบอัตโนมัติอย่างเดียว) */
  function crop(src, quick) {
    const root = document.getElementById('crop');
    root.innerHTML = `<div class="crop-top"><b>ตรวจกรอบสีแดงให้ครอบตารางผลตรวจ</b><div id="cropAuto" role="status">กำลังจัดรูปให้อัตโนมัติ…</div></div>
      <div class="crop-stage"><canvas id="cropCv" aria-label="รูปใบผลแล็บ ลากมุมเพื่อครอบตัด"></canvas></div>
      <div class="crop-ctl">
        <div class="btns c4"><button class="btn" data-cr="l" aria-label="หมุนซ้าย">⟲ ซ้าย</button><button class="btn" data-cr="r" aria-label="หมุนขวา">⟳ ขวา</button><button class="btn" data-cr="all">เต็มรูป</button><button class="btn" data-cr="auto">✨ อัตโนมัติ</button></div>
        <label for="cropFine">ปรับเอียงเล็กน้อย <span id="cropFineV">0°</span></label><input type="range" id="cropFine" min="-15" max="15" step="0.5" value="0">
        <label class="chk"><input type="checkbox" id="cropEnh" checked> ลดเงาและเพิ่มความคมชัด</label>
        <div class="btns"><button class="btn" data-cr="cancel">ยกเลิก</button><button class="btn primary" data-cr="ok" style="flex:2">✓ อ่านข้อความ</button></div>
      </div>`;
    root.hidden = false;
    const cv = root.querySelector('#cropCv'), stage = root.querySelector('.crop-stage'), ctx = cv.getContext('2d'), fineEl = root.querySelector('#cropFine');
    const textQuad = () => { const r = detectRect(src, rot90, fine); return r ? rectToQuad(r) : DEF_QUAD(); };
    let rot90 = 0, fine = 0, q = null, drag = null, cssW = 0, cssH = 0;
    let touched = false, autoRun = 0, autoP = Promise.resolve();              // touched: ผู้ใช้ปรับเองแล้ว → ระบบอัตโนมัติไม่เขียนทับ
    q = textQuad();
    const workDims = () => rot90 % 2 ? [src.height, src.width] : [src.width, src.height];
    const note = t => { const el = root.querySelector('#cropAuto'); if (el) el.textContent = t; };
    const setFine = v => { fine = v; fineEl.value = v; root.querySelector('#cropFineV').textContent = v + '°'; };
    const MANUAL = 'ลากมุมสีแดงทั้ง 4 ไปที่มุมของตาราง (ลากแยกกันได้ถ้าถ่ายเฉียง) · หมุนให้ตัวหนังสือตั้งตรง';

    /** จัดให้อัตโนมัติ: ทิศ → (ถ่ายเฉียง? ใช้มุมกระดาษ 4 จุด : ปรับเอียง + ครอบส่วนที่มีตัวหนังสือ) */
    function arrange() {
      const pq = detectQuad(src, rot90);
      if (pq && pq.persp) { setFine(0); q = pq.pts; return 'แก้รูปถ่ายเฉียง'; }
      setFine(detectSkew(src, rot90));
      const r = detectRect(src, rot90, fine); q = r ? rectToQuad(r) : DEF_QUAD();
      return [fine ? 'ปรับเอียง' : '', r ? 'ครอบส่วนที่มีตัวหนังสือ' : ''].filter(Boolean).join(' · ');
    }
    function auto() {
      const run = ++autoRun; touched = false;
      const stop = () => touched || run !== autoRun || root.hidden;
      const done = (turned, did) => { layout(); const all = [turned ? 'หมุนรูป' : '', did].filter(Boolean).join(' · '); note(`จัดให้แล้ว${all ? ' (' + all + ')' : ''} — ถ้ากรอบแดงครอบตารางครบ กด "อ่านข้อความ" ได้เลย`); };
      if (!quick) return done(false, arrange());
      note('กำลังหาทิศของตัวหนังสือ… (ปรับเองได้เลยถ้าไม่อยากรอ)');
      autoP = detectRotation(src, quick, stop).then(rot => {
        if (stop()) return;
        if (rot == null) { const did = arrange(); layout(); return note('หาทิศของตัวหนังสือไม่ได้' + (did ? ` (${did} ให้แล้ว)` : '') + ' — ' + MANUAL); }
        const turned = rot !== rot90; rot90 = rot; done(turned, arrange());
      }).catch(() => { if (!stop()) note(MANUAL); });
    }

    function layout() {
      const [ww, wh] = workDims(), availW = stage.clientWidth - 24, availH = stage.clientHeight - 24;
      const s = Math.min(availW / ww, availH / wh); cssW = Math.max(60, Math.round(ww * s)); cssH = Math.max(60, Math.round(wh * s));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
      draw();
    }
    function draw() {
      const W = cv.width, H = cv.height, k = W / cssW;
      drawRotated(ctx, src, W, H, rot90, fine);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.rect(0, 0, W, H);
      ctx.moveTo(q[0].x * W, q[0].y * H); for (const i of [3, 2, 1]) ctx.lineTo(q[i].x * W, q[i].y * H); ctx.closePath(); ctx.fill('evenodd');   // มืดนอกกรอบ
      ctx.strokeStyle = '#e53935'; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.moveTo(q[0].x * W, q[0].y * H); for (const i of [1, 2, 3]) ctx.lineTo(q[i].x * W, q[i].y * H); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#e53935'; for (const p of q) { ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 11 * k, 0, 7); ctx.fill(); }
    }
    const pos = e => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }; };
    cv.onpointerdown = e => {
      touched = true;
      const p = pos(e); let best = -1, bd = 36;
      q.forEach((c, i) => { const dpx = Math.hypot((p.x - c.x) * cssW, (p.y - c.y) * cssH); if (dpx < bd) { bd = dpx; best = i; } });
      drag = best >= 0 ? { i: best } : inside(q, p) ? { p, q0: q.map(c => ({ ...c })) } : null;
      if (drag) { cv.setPointerCapture(e.pointerId); e.preventDefault(); }
    };
    cv.onpointermove = e => {
      if (!drag) return;
      const p = pos(e); p.x = Math.min(1, Math.max(0, p.x)); p.y = Math.min(1, Math.max(0, p.y));
      if ('i' in drag) {                                                        // ลากมุมเดียว: ต้องยังเป็นสี่เหลี่ยมนูนและไม่เล็กเกินไป
        const nq = q.map((c, i) => i === drag.i ? p : c);
        if (convex(nq) && area(nq) > 0.01) q = nq;
      } else {                                                                  // ลากข้างในกรอบ: เลื่อนทั้งกรอบ
        let dx = p.x - drag.p.x, dy = p.y - drag.p.y;
        for (const c of drag.q0) { dx = Math.min(1 - c.x, Math.max(-c.x, dx)); dy = Math.min(1 - c.y, Math.max(-c.y, dy)); }
        q = drag.q0.map(c => ({ x: c.x + dx, y: c.y + dy }));
      }
      draw();
    };
    cv.onpointerup = cv.onpointercancel = () => { drag = null; };
    fineEl.oninput = () => { touched = true; fine = +fineEl.value; root.querySelector('#cropFineV').textContent = fine + '°'; draw(); };
    const onResize = () => layout(); window.addEventListener('resize', onResize);
    layout(); auto();

    return new Promise(res => {
      const done = v => { window.removeEventListener('resize', onResize); root.hidden = true; root.innerHTML = ''; res(v); };
      root.onclick = async e => {
        const b = e.target.closest('[data-cr]'); if (!b) return;
        const a = b.dataset.cr;
        if (a === 'auto') return auto();
        if (a !== 'ok') touched = true;                           // กด "อ่านข้อความ" ระหว่างที่ยังจัดอัตโนมัติไม่เสร็จ = รอผลอัตโนมัติก่อน ไม่ใช่ยกเลิกมัน
        if (a === 'l' || a === 'r') { rot90 = (rot90 + (a === 'r' ? 1 : 3)) % 4; q = textQuad(); note(MANUAL); return layout(); }
        if (a === 'all') { q = rectToQuad({ x0: 0, y0: 0, x1: 1, y1: 1 }); note(MANUAL); return draw(); }
        if (a === 'cancel') return done(null);
        if (a === 'ok') {
          b.disabled = true; b.textContent = 'กำลังเตรียมรูป…';
          await autoP.catch(() => {});                              // รอให้ตัวอ่านแบบเร็วทำเสร็จก่อน (ใช้ worker ตัวเดียวกับการอ่านจริง)
          await new Promise(r => setTimeout(r, 30));                // ให้ปุ่มเปลี่ยนข้อความก่อนเริ่มงานหนัก
          const [ww, wh] = workDims(), full = document.createElement('canvas'); full.width = ww; full.height = wh;
          drawRotated(full.getContext('2d', { willReadFrequently: true }), src, ww, wh, rot90, fine);
          const P = q.map(p => ({ x: p.x * ww, y: p.y * wh }));
          let w = Math.max(dist(P[0], P[1]), dist(P[3], P[2])), h = Math.max(dist(P[0], P[3]), dist(P[1], P[2]));
          const flat = isAxisRect(q);
          let up = Math.min(2, Math.max(1, 1600 / w));               // ส่วนที่ครอบเล็กมาก: ขยายให้ตัวหนังสือใหญ่พอสำหรับ OCR
          if (w * h * up * up > 6e6) up = Math.sqrt(6e6 / (w * h));  // จำกัดขนาดผลลัพธ์ไม่ให้กินหน่วยความจำมือถือ
          const outW = Math.max(8, Math.round(w * up)), outH = Math.max(8, Math.round(h * up));
          let out;
          if (flat) {                                                // กรอบตรง: ตัดตรง ๆ (เร็วกว่า)
            out = document.createElement('canvas'); out.width = outW; out.height = outH;
            const octx = out.getContext('2d', { willReadFrequently: true }); octx.imageSmoothingQuality = 'high';
            octx.drawImage(full, Math.round(P[0].x), Math.round(P[0].y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), 0, 0, outW, outH);
          } else out = warp(full, P, outW, outH);                    // กรอบเฉียง: ดึงให้เป็นสี่เหลี่ยม
          return done(root.querySelector('#cropEnh').checked ? enhance(out) : out);
        }
      };
    });
  }

  /** อ่านไฟล์ PDF: คืน { text } ถ้ามีชั้นข้อความ, หรือ { canvas } (หน้าแรก) ถ้าเป็น PDF จากการสแกน
      askPw(wrong:boolean) → Promise<string|null> ถูกเรียกเมื่อไฟล์ตั้งรหัสผ่าน */
  async function readPdf(file, askPw) {
    const pdfjs = await import('./vendor/pdfjs/pdf.min.js');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.js', location.href).href;
    const data = new Uint8Array(await file.arrayBuffer());
    let doc, password;
    for (;;) {
      try { doc = await pdfjs.getDocument({ data: data.slice(), password }).promise; break; }
      catch (e) {
        if (!e || e.name !== 'PasswordException') throw new Error('เปิดไฟล์ PDF ไม่ได้ ไฟล์อาจเสียหาย');
        password = await askPw(password !== undefined);
        if (password == null) { const c = new Error('ยกเลิก'); c.cancelled = true; throw c; }
      }
    }
    try {
      let text = '';                       // ข้อความทั้งหมดแบบเรียงบรรทัด (ใช้หาวันที่ และใช้แทนเมื่อไม่พบตารางหลายคอลัมน์)
      const cols = new Map();              // ป้ายคอลัมน์ผล (เช่น "2026") → ข้อความเฉพาะคอลัมน์นั้น "ชื่อรายการ ค่า"
      for (let n = 1; n <= Math.min(doc.numPages, 40); n++) {
        const page = await doc.getPage(n), tc = await page.getTextContent();
        const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.transform[3]) || i.height || 10 }));
        items.sort((a, b) => b.y - a.y || a.x - b.x);
        const lines = []; let line = [], ly = null;
        const flush = () => { if (line.length) lines.push({ y: ly, items: line.sort((a, b) => a.x - b.x) }); line = []; };
        for (const it of items) { if (ly !== null && Math.abs(it.y - ly) > Math.max(2, it.h * 0.5)) flush(); if (!line.length) ly = it.y; line.push(it); }   // ชิ้นข้อความที่ y ใกล้กัน = บรรทัดเดียวกัน
        flush();
        for (const l of lines) text += l.items.map(i => i.s).join(' ') + '\n';

        // ตารางเทียบหลายปี: หัวตารางมีปี (2026 | 2025 | 2024) เรียงกันในบรรทัดเดียว → ค่าของแต่ละปีอยู่ใต้หัวของปีนั้น
        // ใช้ตำแหน่งแนวนอนแยกว่าเลขไหนเป็นของปีไหน และเลขไหนเป็นค่าอ้างอิง (อยู่ขวาสุด) — ข้อความเรียงบรรทัดอย่างเดียวบอกไม่ได้
        const heads = lines.map(l => ({ y: l.y, yrs: l.items.filter(i => /^(19|20|25)\d\d$/.test(i.s)) })).filter(h => h.yrs.length >= 1 && h.yrs.every(i => i.w < 60));
        heads.forEach((hd, hi) => {
          const c = hd.yrs.map(i => ({ label: i.s, cx: i.x + i.w / 2 })).sort((p, q) => p.cx - q.cx);
          const gapL = c.length > 1 ? c[1].cx - c[0].cx : 70, gapR = c.length > 1 ? c[c.length - 1].cx - c[c.length - 2].cx : 70;
          const left = c[0].cx - gapL / 2, right = c[c.length - 1].cx + gapR / 2;
          const bound = c.map((k, i) => i === 0 ? left : (c[i - 1].cx + k.cx) / 2).concat(right);
          const yEnd = hi + 1 < heads.length ? heads[hi + 1].y : -Infinity;
          for (const l of lines) {
            if (l.y >= hd.y - 1 || l.y <= yEnd) continue;                       // เฉพาะแถวใต้หัวตารางนี้ จนถึงหัวตารางถัดไป
            const mid = i => i.x + i.w / 2, name = l.items.filter(i => mid(i) < left).map(i => i.s).join(' ');
            if (!name) continue;
            c.forEach((k, j) => {
              const cell = l.items.filter(i => mid(i) >= bound[j] && mid(i) < bound[j + 1]).map(i => i.s).join(' ');
              cols.set(k.label, (cols.get(k.label) || '') + name + ' ' + cell + '\n');   // ช่องว่าง = ปีนั้นไม่ได้ตรวจรายการนี้ → ได้แค่ชื่อ ไม่มีเลข
            });
          }
        });
      }
      if (cols.size) {
        const labels = [...cols.keys()].sort().reverse();                       // ปีล่าสุด = ผลปัจจุบัน
        return { text, table: { labels, current: labels[0], colText: cols.get(labels[0]) } };
      }
      if (text.replace(/\s/g, '').length >= 30) return { text };
      const page = await doc.getPage(1), vp0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(3, 2200 / vp0.width) });
      const canvas = document.createElement('canvas'); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      return { canvas };
    } finally { doc.destroy(); }
  }

  return { loadImage, crop, enhance, readPdf, detectRect, detectRotation, detectSkew, detectQuad, warp };
})();
