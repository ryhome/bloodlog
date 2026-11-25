/* BloodLog — ความปลอดภัย: เข้ารหัสข้อมูลในเครื่อง, ปลดล็อกด้วย PIN หรือลายนิ้วมือ/Face ID, เข้ารหัสไฟล์สำรอง
 *
 * โครงสร้างกุญแจ
 *   DEK  = กุญแจ AES-256-GCM สุ่ม ใช้เข้ารหัสข้อมูลทั้งหมด (อยู่ในหน่วยความจำเฉพาะตอนปลดล็อกแล้ว)
 *   PIN  → PBKDF2-SHA256 600,000 รอบ → กุญแจห่อ DEK (pinWrap)
 *   Bio  → WebAuthn PRF (ความลับ 32 ไบต์จากชิปความปลอดภัยของเครื่อง ได้มาเมื่อสแกนผ่านเท่านั้น) → กุญแจห่อ DEK (bio.wrap)
 * สิ่งที่เก็บลง IndexedDB ตอนเปิดการล็อก: { vault:1, kdf, pinWrap, bio, font, data:{iv,ct} } — ไม่มีข้อมูลสุขภาพแบบอ่านได้
 *
 * ข้อจำกัดที่ต้องรู้: PIN ตัวเลข 6 หลักกันคนหยิบเครื่องไปเปิดดูได้ แต่ถ้ามีคนคัดลอกข้อมูลดิบของเบราว์เซอร์ออกไป
 * เขาเดา PIN แบบออฟไลน์ได้ (1 ล้านแบบ) — PBKDF2 ทำให้ช้าลง ไม่ได้ทำให้เป็นไปไม่ได้ ใช้ PIN ยาวขึ้นถ้าต้องการกันกรณีนี้
 */
'use strict';

const Sec = (() => {
  const C = crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
  const ITER = 600000;
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function pbkdf(secret, salt, iter) {
    const base = await C.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return C.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const aesEnc = async (key, bytes) => { const iv = rand(12); return { iv, ct: new Uint8Array(await C.encrypt({ name: 'AES-GCM', iv }, key, bytes)) }; };
  const aesDec = async (key, box) => new Uint8Array(await C.decrypt({ name: 'AES-GCM', iv: box.iv }, key, box.ct));

  let dek = null;      // CryptoKey — มีค่าเฉพาะตอนปลดล็อกแล้ว
  let meta = null;     // { kdf:{salt,iter}, pinWrap:{iv,ct}, bio:{credId,salt,wrap}|null } — มีค่าเมื่อเปิดใช้การล็อก

  const wrapDek = async k => aesEnc(k, new Uint8Array(await C.exportKey('raw', dek)));
  const unwrapDek = async (k, box) => C.importKey('raw', await aesDec(k, box), 'AES-GCM', true, ['encrypt', 'decrypt']);

  /* ----- WebAuthn PRF ----- */
  async function prfGet(credId, salt, signal) {
    const a = await navigator.credentials.get({ signal, publicKey: {
      challenge: rand(32), allowCredentials: [{ type: 'public-key', id: credId }], userVerification: 'required', timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    } });
    const r = a.getClientExtensionResults().prf;
    if (!r || !r.results || !r.results.first) throw new Error('noprf');
    return r.results.first;
  }
  const prfKey = out => C.importKey('raw', out, 'AES-GCM', false, ['encrypt', 'decrypt']);

  return {
    get enabled() { return !!meta; },          // เปิดใช้การล็อกอยู่
    get unlocked() { return !!dek; },
    get hasBio() { return !!(meta && meta.bio); },

    /** เรียกตอนเปิดแอปเมื่อพบข้อมูลที่เข้ารหัสไว้ */
    load(v) { meta = { kdf: v.kdf, pinWrap: v.pinWrap, bio: v.bio || null }; dek = null; },
    lock() { dek = null; },
    disable() { dek = null; meta = null; },

    async enable(pin) {
      dek = await C.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      const salt = rand(16);
      meta = { kdf: { salt, iter: ITER }, pinWrap: null, bio: null };
      meta.pinWrap = await wrapDek(await pbkdf(pin, salt, ITER));
    },
    async unlockPin(pin) {
      try { dek = await unwrapDek(await pbkdf(pin, meta.kdf.salt, meta.kdf.iter), meta.pinWrap); return true; } catch (e) { return false; }
    },
    async checkPin(pin) {
      try { await aesDec(await pbkdf(pin, meta.kdf.salt, meta.kdf.iter), meta.pinWrap); return true; } catch (e) { return false; }
    },
    async changePin(pin) {
      const salt = rand(16), pinWrap = await wrapDek(await pbkdf(pin, salt, ITER));
      meta.kdf = { salt, iter: ITER }; meta.pinWrap = pinWrap;
    },

    /** เปิดใช้ลายนิ้วมือ/Face ID — โยน Error('nosupport'|'noprf') ถ้าเครื่องนี้ทำไม่ได้ */
    async bioEnable() {
      if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('nosupport');
      const salt = rand(32);
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: rand(32), rp: { name: 'BloodLog' },
        user: { id: rand(16), name: 'bloodlog', displayName: 'BloodLog' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000, extensions: { prf: { eval: { first: salt } } },
      } });
      const ext = cred.getClientExtensionResults().prf;
      if (!ext || !ext.enabled) throw new Error('noprf');
      const credId = new Uint8Array(cred.rawId);
      const out = (ext.results && ext.results.first) || await prfGet(credId, salt);   // บางเครื่องต้องสแกนอีกครั้งเพื่อรับค่า PRF
      meta.bio = { credId, salt, wrap: await wrapDek(await prfKey(out)) };
    },
    bioDisable() { if (meta) meta.bio = null; },
    /** signal: AbortSignal ให้ผู้ใช้กดยกเลิกแล้วกลับไปใช้ PIN ได้ ถ้าหน้าต่างสแกนค้าง */
    async unlockBio(signal) {
      try { dek = await unwrapDek(await prfKey(await prfGet(meta.bio.credId, meta.bio.salt, signal)), meta.bio.wrap); return true; } catch (e) { return false; }
    },

    /* ----- ข้อมูลในเครื่อง ----- */
    async seal(obj) { return aesEnc(dek, te.encode(JSON.stringify(obj))); },
    async open(box) { return JSON.parse(td.decode(await aesDec(dek, box))); },
    envelope(font, data) { return { vault: 1, kdf: meta.kdf, pinWrap: meta.pinWrap, bio: meta.bio, font, data }; },

    /* ----- ไฟล์สำรอง: เข้ารหัสด้วยรหัสผ่านที่ผู้ใช้ตั้งตอนส่งออก (แยกจาก PIN) ----- */
    async packBackup(obj, password) {
      const salt = rand(16), box = await aesEnc(await pbkdf(password, salt, ITER), te.encode(JSON.stringify(obj)));
      return JSON.stringify({ app: 'bloodlog', enc: 1, kdf: 'PBKDF2-SHA256', iter: ITER, cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(box.iv), ct: b64(box.ct) });
    },
    async openBackup(env, password) {
      const iter = Math.min(Math.max(+env.iter || 0, 1000), 5000000);       // ไฟล์มาจากภายนอก: จำกัดจำนวนรอบไม่ให้แอปค้าง
      const key = await pbkdf(password, unb64(env.salt), iter);
      return JSON.parse(td.decode(await aesDec(key, { iv: unb64(env.iv), ct: unb64(env.ct) })));
    },
  };
})();

/* ---------- แป้น PIN (ใช้ทั้งปลดล็อก ตั้ง PIN และยืนยัน PIN) ---------- */
const PinPad = (() => {
  const MIN = 6, MAX = 12;
  let buf = '', resolve = null, opt = {};
  const el = () => document.getElementById('lock');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function draw() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', opt.bio ? 'bio' : '', '0', 'del'];
    el().innerHTML = `<div class="lockbox" role="dialog" aria-modal="true" aria-label="${esc(opt.title)}">
      <div class="lk-title">🔒 ${esc(opt.title)}</div>
      <div class="lk-sub">${esc(opt.sub || '')}</div>
      <div class="dots" aria-label="ใส่แล้ว ${buf.length} หลัก">${'●'.repeat(buf.length) || '<span class="mute">– – – – – –</span>'}</div>
      <div class="lk-msg" id="lkMsg" role="alert">${esc(opt.msg || '')}</div>
      <div class="pad">${keys.map(k => k === '' ? '<span></span>'
        : k === 'bio' ? '<button data-lk="bio" aria-label="ใช้ลายนิ้วมือหรือ Face ID">👆</button>'
        : k === 'del' ? '<button data-lk="del" aria-label="ลบ">⌫</button>'
        : `<button data-lk="${k}">${k}</button>`).join('')}</div>
      <button class="btn primary block" data-lk="ok">ตกลง</button>
      ${opt.bio ? '<button class="btn block" data-lk="bio">👆 ใช้ลายนิ้วมือ / Face ID</button>' : ''}
      ${opt.cancel ? '<button class="btn block" data-lk="cancel">ยกเลิก</button>' : ''}
      ${opt.busy && opt.onAbort ? '<button class="btn block" data-lk="abort">ยกเลิก แล้วใช้ PIN แทน</button>' : ''}
      ${opt.forgot ? '<button class="lk-link" data-lk="forgot">ลืม PIN?</button>' : ''}
    </div>`;
  }
  function finish(v) { const r = resolve; resolve = null; if (r) r(v); }
  function press(k) {
    if (k === 'abort' && opt.busy && opt.onAbort) return opt.onAbort();
    if (!resolve || opt.busy) return;
    if (/^\d$/.test(k)) { if (buf.length < MAX) buf += k; opt.msg = ''; return draw(); }
    if (k === 'del') { buf = buf.slice(0, -1); return draw(); }
    if (k === 'ok') { if (buf.length < MIN) { opt.msg = `PIN ต้องมีอย่างน้อย ${MIN} หลัก`; return draw(); } const v = buf; buf = ''; return finish(v); }
    if (k === 'bio') return finish({ bio: true });
    if (k === 'cancel') return finish(null);
    if (k === 'forgot') return finish({ forgot: true });
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-lk]'); if (b && !el().hidden) press(b.dataset.lk); });
  document.addEventListener('keydown', e => {
    if (el().hidden || !resolve) return;
    if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); else if (e.key === 'Enter') press('ok'); else if (e.key === 'Escape' && opt.cancel) press('cancel'); else return;
    e.preventDefault();
  });

  return {
    get open() { return !el().hidden; },
    /** คืน string (PIN) | {bio:true} | {forgot:true} | null (ยกเลิก) — แป้นยังเปิดค้างไว้จนกว่าจะเรียก close() */
    ask(o) { opt = { ...o, busy: false }; buf = ''; el().hidden = false; draw(); return new Promise(r => { resolve = r; }); },
    /** onAbort: ถ้าให้มา จะมีปุ่มยกเลิกระหว่างรอ (ใช้ตอนรอสแกนลายนิ้วมือ) */
    busy(msg, onAbort) { opt.busy = true; opt.msg = msg; opt.onAbort = onAbort || null; draw(); },
    close() { el().hidden = true; el().innerHTML = ''; buf = ''; resolve = null; },
  };
})();

/* ---------- กล่องถามรหัสผ่าน (ไฟล์สำรอง / PDF) ---------- */
function askPassword(o) {
  const m = document.getElementById('modal');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Promise(res => {
    m.innerHTML = `<form class="card" role="dialog" aria-modal="true" aria-label="${esc(o.title)}" autocomplete="off">
      <b>${esc(o.title)}</b>${o.sub ? `<p class="mute">${esc(o.sub)}</p>` : ''}
      <label for="pw1">รหัสผ่าน</label><input id="pw1" type="password" autocomplete="new-password" autocapitalize="off">
      ${o.confirm ? '<label for="pw2">พิมพ์อีกครั้ง</label><input id="pw2" type="password" autocomplete="new-password" autocapitalize="off">' : ''}
      <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="pwShow" style="width:auto;min-height:0"> แสดงรหัสผ่าน</label>
      <div class="lk-msg" id="pwMsg" role="alert"></div>
      <div class="btns"><button type="button" class="btn" id="pwCancel">ยกเลิก</button><button class="btn primary">ตกลง</button></div></form>`;
    m.hidden = false;
    const f = m.querySelector('form'), p1 = m.querySelector('#pw1'), p2 = m.querySelector('#pw2');
    const done = v => { m.hidden = true; m.innerHTML = ''; res(v); };
    m.querySelector('#pwShow').onchange = e => { for (const i of [p1, p2]) if (i) i.type = e.target.checked ? 'text' : 'password'; };
    m.querySelector('#pwCancel').onclick = () => done(null);
    f.onsubmit = e => {
      e.preventDefault();
      const v = p1.value, msg = m.querySelector('#pwMsg');
      if (p2 && v !== p2.value) return void (msg.textContent = 'รหัสผ่านสองช่องไม่ตรงกัน');
      if (v === '' && !o.allowEmpty) return void (msg.textContent = 'กรุณาใส่รหัสผ่าน');
      if (v !== '' && o.min && v.length < o.min) return void (msg.textContent = `รหัสผ่านต้องยาวอย่างน้อย ${o.min} ตัวอักษร`);
      done(v);
    };
    p1.focus();
  });
}
