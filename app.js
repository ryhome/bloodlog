/* BloodLog — แอปหลัก (vanilla JS, ไม่มี build step, ข้อมูลอยู่ใน IndexedDB ของเครื่องเท่านั้น) */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const p2 = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fmtDate = (iso, long) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: long ? 'numeric' : '2-digit' }); };
const fmtNum = v => Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
const recKey = r => r.date + 'T' + (r.time || '00:00');
const recTs = r => new Date(recKey(r)).getTime();

/* ---------- storage ---------- */
const Store = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open('bloodlog', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => { this.db = rq.result; res(); };
      rq.onerror = () => rej(rq.error);
    });
  },
  get(k) { return new Promise((res, rej) => { const rq = this.db.transaction('kv').objectStore('kv').get(k); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); },
  del(k) { return new Promise((res, rej) => { const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  set(k, v) { return new Promise((res, rej) => { const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
};

let S = null;              // state
let ui = { tab: 'home', trendTest: null, draft: null, hist: 'all', off: {} };   // off[testId] = ย้อนหลังกี่ครั้งจากค่าล่าสุด (หน้าภาพรวม)

function freshState() {
  return { v: 2, profiles: [{ id: 'p1', name: 'ฉัน', sex: '', dob: '', height: null }], activeProfile: 'p1', tests: structuredClone(DEFAULT_TESTS), records: [], font: 0, simple: false, created: today(), lastBackup: null, backupSnooze: null };
}
/** ตรวจรูปแบบ + อัปเกรดข้อมูลจากเวอร์ชันเก่า (ใช้ทั้งตอนเปิดแอปและตอนกู้คืนไฟล์สำรอง) */
function normalize(s) {
  if (!s || !Array.isArray(s.profiles) || !Array.isArray(s.records) || !Array.isArray(s.tests)) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
  // ไฟล์สำรองเป็นข้อมูลจากภายนอก: รับเฉพาะ id ที่ปลอดภัย, ตัดรายการซ้ำ, บังคับชนิดข้อมูลทุกช่อง
  const okId = v => typeof v === 'string' && /^[\w-]{1,40}$/.test(v);
  const numOrNull = v => v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v;
  const str = (v, max = 200) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').slice(0, max);
  const uniq = arr => { const seen = new Set(); return arr.filter(x => !seen.has(x.id) && seen.add(x.id)); };
  s.profiles = uniq(s.profiles.filter(p => p && okId(p.id)));
  if (!s.profiles.length) s.profiles = [{ id: 'p1', name: 'ฉัน' }];
  s.tests = uniq(s.tests.filter(t => t && okId(t.id) && typeof t.name === 'string' && t.name.trim()));
  for (const t of s.tests) {
    t.name = str(t.name, 80); t.group = str(t.group, 60) || 'อื่น ๆ'; t.unit = str(t.unit, 30);
    t.low = numOrNull(t.low); t.high = numOrNull(t.high);
    t.aliases = Array.isArray(t.aliases) ? t.aliases.filter(a => typeof a === 'string').map(a => a.slice(0, 60)) : [];
    if (t.bySex && typeof t.bySex === 'object') { for (const k of ['m', 'f']) { const b = t.bySex[k] || {}; t.bySex[k] = { low: numOrNull(b.low), high: numOrNull(b.high) }; } }
    else delete t.bySex;
    if (typeof t.th === 'string' && t.th) t.th = t.th.slice(0, 80); else delete t.th;
    t.pin = !!t.pin; t.hidden = !!t.hidden; t.custom = !!t.custom;
  }
  for (const p of s.profiles) { p.name = str(p.name, 60).trim() || 'ไม่มีชื่อ'; p.sex = ['m', 'f'].includes(p.sex) ? p.sex : ''; p.dob = /^\d{4}-\d{2}-\d{2}$/.test(p.dob || '') ? p.dob : ''; p.height = isFinite(+p.height) && +p.height > 0 ? +p.height : null; }
  if (!s.profiles.some(p => p.id === s.activeProfile)) s.activeProfile = s.profiles[0].id;
  for (const d of DEFAULT_TESTS) {
    const t = s.tests.find(x => x.id === d.id);
    if (!t) { s.tests.push(structuredClone(d)); continue; }          // รายการมาตรฐานใหม่
    if (d.bySex && t.bySex === undefined) t.bySex = structuredClone(d.bySex);
    t.aliases = [...new Set([...(t.aliases || []), ...d.aliases])];      // รับคำเรียกใหม่จากเวอร์ชันถัดไป (เช่น คำภาษาไทย) โดยไม่ทิ้งคำที่ผู้ใช้เพิ่มเอง
    t.kind = d.kind;
    if (d.th && t.th === undefined) t.th = d.th;
  }
  for (const t of s.tests) t.kind = t.kind === 'body' ? 'body' : 'lab';
  s.records = uniq(s.records.filter(r => r && okId(r.id) && s.profiles.some(p => p.id === r.profileId) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.values && typeof r.values === 'object'));
  for (const r of s.records) {
    r.lab = str(r.lab); r.note = str(r.note);
    r.kind = r.kind === 'body' ? 'body' : 'lab';
    if (!/^\d{2}:\d{2}$/.test(r.time || '')) delete r.time;
    for (const k of Object.keys(r.values)) { r.values[k] = Number(r.values[k]); if (!isFinite(r.values[k])) delete r.values[k]; }
  }
  s.font = [0, 1, 2].includes(s.font) ? s.font : 0;
  s.simple = !!s.simple;
  const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  s.created = isDate(s.created) ? s.created : today();
  s.lastBackup = isDate(s.lastBackup) ? s.lastBackup : null;
  s.backupSnooze = isDate(s.backupSnooze) ? s.backupSnooze : null;
  s.v = 2;
  return s;
}
let memOnly = false;
let saveQ = Promise.resolve();
/** บันทึกทีละครั้งตามลำดับ (การเข้ารหัสเป็น async — ถ้าไม่เข้าคิว การบันทึกที่เริ่มทีหลังอาจเขียนเสร็จก่อนแล้วถูกทับด้วยข้อมูลเก่า) */
function save() {
  const snap = S;
  return (saveQ = saveQ.then(async () => {
    if (memOnly || !snap) return;
    try { await Store.set('state', Sec.enabled ? Sec.envelope(snap.font, await Sec.seal(snap)) : snap); }
    catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message); }
  }));
}

/* ---------- helpers ---------- */
const testById = id => S.tests.find(t => t.id === id);
const prof = () => S.profiles.find(p => p.id === S.activeProfile);
const myRecords = kind => S.records.filter(r => r.profileId === S.activeProfile && (!kind || r.kind === kind)).sort((a, b) => recKey(a).localeCompare(recKey(b)));
const SEX_TH = { m: 'ชาย', f: 'หญิง', '': '' };
const KIND_TH = { lab: 'ผลเลือด', body: 'วัดร่างกาย' };
const KIND_ICON = { lab: '🩸', body: '📏' };
function ageOf(dob, at) {              // at = 'YYYY-MM-DD' (อายุ ณ วันนั้น) ไม่ระบุ = วันนี้
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number), n = at ? new Date(at + 'T00:00') : new Date();
  let a = n.getFullYear() - y; if (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d)) a--;
  return a >= 0 && a < 130 ? a : null;
}
function profLine(p) {
  const a = ageOf(p.dob);
  return [SEX_TH[p.sex], a != null ? `${a} ปี` : '', p.height ? `${fmtNum(p.height)} ซม.` : ''].filter(Boolean).join(' · ');
}
/** ช่วงอ้างอิงที่ใช้จริง: ถ้ารายการมีช่วงแยกตามเพศและโปรไฟล์ระบุเพศ จะใช้ช่วงของเพศนั้น */
function rng(t) { const b = t.bySex && t.bySex[prof().sex]; return b || { low: t.low ?? null, high: t.high ?? null }; }
function statusOf(t, v) {
  const r = rng(t);
  if (r.low != null && v < r.low) return 'low';
  if (r.high != null && v > r.high) return 'high';
  return (r.low == null && r.high == null) ? '' : 'ok';
}
const STATUS_TH = { low: 'ต่ำ', high: 'สูง', ok: 'ปกติ', '': '' };
const chip = st => st ? `<span class="chip ${st}">${STATUS_TH[st]}</span>` : '';
function rangeText(t) {
  const r = rng(t);
  if (r.low != null && r.high != null) return `${r.low}–${r.high}`;
  if (r.low != null) return `≥ ${r.low}`;
  if (r.high != null) return `≤ ${r.high}`;
  return '';
}
/** Map หมวด → รายการ; ไม่ระบุ kind = ทั้งหมดโดยเรียงวัดร่างกายก่อน */
function groups(kind) {
  const g = new Map();
  for (const k of kind ? [kind] : ['body', 'lab'])
    for (const t of S.tests) { if (t.kind !== k) continue; if (!g.has(t.group)) g.set(t.group, []); g.get(t.group).push(t); }
  return g;
}
function series(testId) { return myRecords().filter(r => testId in r.values).map(r => ({ date: r.date, ts: recTs(r), v: r.values[testId], rec: r })); }
/* ----- บันทึกด่วน ----- */
const QUICK = {
  bp:     { label: 'ความดัน', ids: ['sys', 'dia', 'hr'] },
  weight: { label: 'น้ำหนัก', ids: ['weight', 'bmi'] },
  sugar:  { label: 'น้ำตาล', ids: ['dtx_f', 'dtx_pp'] },
};

/* ----- ความดันเป็นคู่ (ตัวบน/ตัวล่าง) ----- */
const BP_GAP = 10 * 60 * 1000;      // วัดห่างกันไม่เกิน 10 นาทีในวันเดียวกัน = รอบเดียวกัน แล้วเฉลี่ย
const mean = (arr, k) => Math.round(arr.reduce((a, x) => a + x[k], 0) / arr.length);
function bpReadings() {
  return myRecords().filter(r => 'sys' in r.values && 'dia' in r.values)
    .map(r => ({ ts: recTs(r), date: r.date, time: r.time || '', sys: r.values.sys, dia: r.values.dia }));
}
function bpSessions() {
  const out = [];
  for (const r of bpReadings()) {
    const last = out[out.length - 1];
    if (last && r.time && last.time && r.date === last.date && r.ts - last.end <= BP_GAP) { last.items.push(r); last.end = r.ts; }
    else out.push({ date: r.date, time: r.time, ts: r.ts, end: r.ts, items: [r] });
  }
  for (const x of out) { x.sys = mean(x.items, 'sys'); x.dia = mean(x.items, 'dia'); x.n = x.items.length; }
  return out;
}
function bpAvg(days) {
  const from = Date.now() - days * 864e5, r = bpReadings().filter(x => x.ts >= from);
  return r.length ? { sys: mean(r, 'sys'), dia: mean(r, 'dia'), n: r.length } : null;
}
function bpStatus(sys, dia) {
  const a = statusOf(testById('sys'), sys), b = statusOf(testById('dia'), dia);
  return [a, b].includes('high') ? 'high' : [a, b].includes('low') ? 'low' : (a || b);
}
const pairOf = id => id === 'sys' ? 'dia' : id === 'dia' ? 'sys' : null;
/** มีการบันทึกความดันที่กรอกมาแค่ตัวเดียวหรือไม่ (ข้อมูลเก่า/นำเข้า) — ถ้ามีต้องยังแสดงแถวเดี่ยวไว้ ไม่อย่างนั้นค่านั้นจะมองไม่เห็น */
const bpLone = id => myRecords().some(r => id in r.values && !('sys' in r.values && 'dia' in r.values));
const rowLen = id => id === 'bp' ? bpSessions().length : series(id).length;
const rowHTML = (id, anim) => id === 'bp' ? bpRow(anim) : homeRow(testById(id), anim);

let toastT;
/** act = { label, fn } → แสดงปุ่มในข้อความ (เช่น "เลิกทำ") และค้างไว้นานขึ้น */
function toast(msg, act) {
  const el = $('#toast'); el.textContent = msg; el.classList.toggle('act', !!act);
  if (act) { const b = document.createElement('button'); b.textContent = act.label; b.onclick = () => { el.classList.remove('show', 'act'); act.fn(); }; el.append(b); }
  el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show', 'act'), act ? 8000 : 2600);
}
/** เก็บสำเนาสถานะก่อนลบ แล้วให้กด "เลิกทำ" ได้ 8 วินาที */
function offerUndo(msg, snap) { toast(msg, { label: 'เลิกทำ', fn: async () => { S = snap; await save(); render(); toast('กู้คืนแล้ว'); } }); }
const simpleActive = () => S.simple && !ui.care;      // โหมดผู้สูงอายุกำลังแสดงอยู่ (ผู้ดูแลกดเข้าโหมดเต็มได้ชั่วคราว)
/** จำนวนวันที่ไม่ได้สำรอง ถ้าถึงเวลาเตือน (≥30 วัน และไม่ได้กดเลื่อน) ไม่อย่างนั้นคืน 0 */
function backupDue() {
  if (!S.records.length) return 0;
  const days = Math.floor((Date.now() - new Date((S.lastBackup || S.created) + 'T00:00').getTime()) / 864e5);
  if (days < 30 || (S.backupSnooze && today() < S.backupSnooze)) return 0;
  return days;
}

/* ---------- views ---------- */
const FONT_TH = ['ปกติ', 'ใหญ่', 'ใหญ่มาก'];
function render(keep) {
  const y0 = window.scrollY;
  document.documentElement.dataset.font = S.font || 0;
  document.body.dataset.tab = ui.tab;
  document.body.dataset.simple = simpleActive() ? 1 : 0;      // หน้ากรอกข้อมูล: ซ่อนแถบเมนูล่าง แล้วใช้ที่ตรงนั้นวางปุ่มบันทึกแบบติดจอ
  $('#profileSel').innerHTML = S.profiles.map(p => `<option value="${esc(p.id)}"${p.id === S.activeProfile ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $$('nav button').forEach(b => b.removeAttribute('aria-current'));
  const cur = $(`nav button[data-tab="${ui.tab}"]`); if (cur) cur.setAttribute('aria-current', 'page');
  $('#fab').hidden = !['home', 'history'].includes(ui.tab) || simpleActive();
  $('#sheet').hidden = true;
  $('#view').innerHTML = ({ home: simpleActive() ? viewSimple : viewHome, history: viewHistory, trend: viewTrend, summary: viewSummary, settings: viewSettings, edit: viewEdit, test: viewTest, prof: viewProf }[ui.tab])();
  window.scrollTo(0, keep ? y0 : 0);
}

function emptyState() {
  return `<div class="empty"><div style="font-size:3rem">🩸</div><h2>ยังไม่มีข้อมูล</h2>
    <p>กดปุ่ม + เพื่อถ่ายรูปใบผลแล็บ หรือบันทึกความดัน น้ำหนัก น้ำตาล</p>
    <button class="btn primary" data-act="new">เริ่มบันทึกครั้งแรก</button></div>${quickBar()}`;
}

/** ปุ่ม ‹ › สำหรับดูค่าครั้งก่อน/ถัดไป (ใช้แทนการปัดได้) */
const posHTML = (id, i, n) => n > 1 ? `<div class="pos"><button class="ar${i > 0 ? '' : ' dim'}" data-act="step" data-id="${esc(id)}:1" aria-label="ดูครั้งก่อนหน้า">‹</button><span>${i + 1}/${n}</span><button class="ar${i < n - 1 ? '' : ' dim'}" data-act="step" data-id="${esc(id)}:-1" aria-label="ดูครั้งถัดไป">›</button></div>` : '';
/** แถวหนึ่งรายการบนหน้าภาพรวม — ปัดขวา = ค่าที่เก่ากว่า, ปัดซ้าย = ค่าที่ใหม่กว่า, แตะ = กราฟ */
function homeRow(t, anim) {
  const s = series(t.id); if (!s.length) return '';
  const off = Math.min(ui.off[t.id] || 0, s.length - 1), i = s.length - 1 - off;
  const cur = s[i], prev = s[i - 1], st = statusOf(t, cur.v);
  let delta = '';
  if (prev) { const d = cur.v - prev.v; delta = d === 0 ? '→ เท่าเดิม' : `${d > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(d))}`; }
  const spark = sparkSVG(t, s.slice(Math.max(0, i - 2), i + 1));
  const pos = posHTML(t.id, i, s.length);
  return `<div role="button" tabindex="0" class="row${off ? ' past' : ''}${anim ? ' ' + anim : ''}" data-act="trend" data-id="${esc(t.id)}" data-swipe="${esc(t.id)}"
      aria-label="${esc(t.th || t.name)} ${fmtNum(cur.v)} ${esc(t.unit)} วันที่ ${fmtDate(cur.date)} ครั้งที่ ${i + 1} จาก ${s.length}">
    ${spark}
    <span class="grow"><div>${esc(t.th || t.name)}</div><div class="mute">${t.th ? esc(t.name) + ' · ' : ''}${off ? '<b>ย้อนหลัง</b> · ' : ''}${fmtDate(cur.date)}${cur.rec.time ? ' ' + esc(cur.rec.time) : ''}${rangeText(t) ? ' · เกณฑ์ ' + esc(rangeText(t)) : ''}</div></span>
    <span class="vcol" style="text-align:right"><div class="val">${fmtNum(cur.v)} <span class="mute">${esc(t.unit)}</span></div><div class="delta">${delta}</div>${pos}</span>
    ${chip(st)}</div>`;
}
/** แถวความดันแบบคู่ 135/88 — แต่ละตำแหน่งคือหนึ่ง "รอบวัด" (วัดติดกันหลายครั้งจะถูกเฉลี่ย) */
function bpRow(anim) {
  const s = bpSessions(); if (!s.length) return '';
  const off = Math.min(ui.off.bp || 0, s.length - 1), i = s.length - 1 - off, cur = s[i], prev = s[i - 1];
  const ar = d => d === 0 ? '→' : (d > 0 ? '▲' : '▼') + Math.abs(d);
  const delta = prev ? `${ar(cur.sys - prev.sys)} / ${ar(cur.dia - prev.dia)}` : '';
  const a7 = off ? null : bpAvg(7);
  const pos = posHTML('bp', i, s.length);
  return `<div role="button" tabindex="0" class="row${off ? ' past' : ''}${anim ? ' ' + anim : ''}" data-act="trend" data-id="bp" data-swipe="bp"
      aria-label="ความดัน ${cur.sys} ทับ ${cur.dia} วันที่ ${fmtDate(cur.date)} ครั้งที่ ${i + 1} จาก ${s.length}">
    ${sparkSVG(testById('sys'), s.slice(Math.max(0, i - 2), i + 1).map(x => ({ v: x.sys })))}
    <span class="grow"><div>ความดัน</div><div class="mute">${off ? '<b>ย้อนหลัง</b> · ' : ''}${fmtDate(cur.date)}${cur.time ? ' ' + esc(cur.time) : ''}${cur.n > 1 ? ` · เฉลี่ย ${cur.n} ครั้ง` : ''}${a7 && a7.n > 1 ? ` · เฉลี่ย 7 วัน ${a7.sys}/${a7.dia}` : ''}</div></span>
    <span class="vcol" style="text-align:right"><div class="val">${cur.sys}/${cur.dia} <span class="mute">mmHg</span></div><div class="delta">${delta}</div>${pos}</span>
    ${chip(bpStatus(cur.sys, cur.dia))}</div>`;
}
/** กราฟเส้นจาง ๆ เป็นพื้นหลังของแถว: สูงสุด 3 ครั้งล่าสุดจนถึงค่าที่กำลังแสดง (จุดขวาสุด = ค่าที่แสดง) */
function sparkSVG(t, pts) {
  if (pts.length < 2) return '';
  const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), n = pts.length;
  const x = i => 100 - 6 - (n - 1 - i) * 30;                       // ชิดขวา ห่างกันจุดละ 30%
  const y = v => hi === lo ? 20 : 32 - (v - lo) / (hi - lo) * 24;  // ใช้ความสูง 20–80%
  const xy = pts.map((p, i) => [x(i), +y(p.v).toFixed(1)]);
  const line = xy.map(p => p.join(',')).join(' ');
  const col = st => st === 'high' ? 'var(--hi)' : st === 'low' ? 'var(--lo)' : st === 'ok' ? 'var(--ok)' : 'var(--mute)';
  return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="${xy[0][0]},40 ${line} ${xy[n - 1][0]},40" fill="var(--mute)" opacity=".035"/>
    <polyline points="${line}" fill="none" stroke="var(--mute)" stroke-width="1.5" opacity=".16" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    ${xy.map((p, i) => `<path d="M${p[0]} ${p[1]}h0" stroke="${col(statusOf(t, pts[i].v))}" stroke-width="${i === n - 1 ? 8 : 5}" opacity="${i === n - 1 ? .3 : .18}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`).join('')}</svg>`;
}
function stepRow(id, dir) {          // dir +1 = เก่ากว่า, -1 = ใหม่กว่า
  const n = rowLen(id), cur = ui.off[id] || 0, next = Math.max(0, Math.min(n - 1, cur + dir));
  if (next === cur) return toast(dir > 0 ? 'ไม่มีค่าที่เก่ากว่านี้แล้ว' : 'นี่คือค่าล่าสุดแล้ว');
  ui.off[id] = next;
  const el = $(`[data-swipe="${CSS.escape(id)}"]`), hadFocus = el === document.activeElement;
  if (!el) return;
  el.outerHTML = rowHTML(id, dir > 0 ? 'in-l' : 'in-r');
  if (hadFocus) $(`[data-swipe="${CSS.escape(id)}"]`).focus();
}

function viewHome() {
  const recs = myRecords();
  if (!recs.length) return emptyState();
  const hasBP = bpSessions().length > 0;
  let abn = 0, rows = '', pinned = '';
  for (const [g, tests] of groups()) {
    let inner = '';
    for (const t of tests) {
      if (t.hidden) continue;
      let html = '';
      if (hasBP && pairOf(t.id)) {
        if (t.id === 'sys') {                               // แสดงรวมเป็นแถวเดียวที่ตำแหน่งของตัวบน
          const last = bpSessions().pop();
          if (['low', 'high'].includes(bpStatus(last.sys, last.dia))) abn++;
          html = bpRow();
        }
        if (bpLone(t.id)) html += homeRow(t);               // มีค่าที่กรอกมาตัวเดียว: คงแถวเดี่ยวไว้ด้วย
      } else {
        const s = series(t.id); if (!s.length) continue;
        if (['low', 'high'].includes(statusOf(t, s[s.length - 1].v))) abn++;
        html = homeRow(t);
      }
      if (t.pin) pinned += html; else inner += html;
    }
    if (inner) rows += `<h2>${esc(g)}</h2><div class="card">${inner}</div>`;
  }
  if (pinned) rows = `<h2>📌 ปักหมุด</h2><div class="card">${pinned}</div>` + rows;
  const lastLab = myRecords('lab').pop(), p = prof(), due = backupDue();
  const dv = derived(), dhtml = dv.length ? `<h2>ค่าที่คำนวณจากข้อมูล</h2><div class="card">${dv.map(x => x.hint ? `<p class="mute" style="margin:6px 0">${esc(x.hint)}</p>`
    : `<div class="row"><span class="grow"><div>${esc(x.name)}</div><div class="mute">${esc(x.sub)} · ${fmtDate(x.date)}</div></span><span class="val">${fmtNum(x.v)} <span class="mute">${esc(x.unit)}</span></span>${chip(x.st)}</div>`).join('')}</div>` : '';
  return `${due ? `<div class="card warn"><b>⚠️ ยังไม่ได้สำรองข้อมูลมา ${due} วัน</b><div class="mute">ข้อมูลอยู่ในเครื่องนี้เครื่องเดียว ถ้าเครื่องหายหรือล้างข้อมูลเบราว์เซอร์ ข้อมูลจะหายทั้งหมด</div>
      <div class="btns" style="margin-top:8px"><button class="btn primary" data-act="export">สำรองเดี๋ยวนี้</button><button class="btn" data-act="snooze">เตือนอีกใน 7 วัน</button></div></div>` : ''}${profLine(p) ? `<p class="mute" style="margin:0 2px 10px">${esc(p.name)} · ${esc(profLine(p))}</p>` : `<p class="mute" style="margin:0 2px 10px">ยังไม่ได้ระบุเพศ/วันเกิด/ส่วนสูง — <a href="#" data-act="renProf" data-id="${esc(p.id)}">ตั้งค่าโปรไฟล์</a> เพื่อใช้เกณฑ์ตามเพศและคำนวณ BMI</p>`}
    <div class="summary">
      <div class="card"><b>${recs.length}</b><span class="mute">ครั้งที่บันทึก</span></div>
      <div class="card"><b style="color:${abn ? 'var(--hi)' : 'var(--ok)'}">${abn}</b><span class="mute">ค่าล่าสุดนอกเกณฑ์</span></div>
      <div class="card"><b style="font-size:1rem;line-height:2.25rem">${lastLab ? fmtDate(lastLab.date) : '–'}</b><span class="mute">ตรวจเลือดล่าสุด</span></div>
    </div>
    ${quickBar()}
    <button class="btn block" data-act="summary" style="margin:0 0 10px">📋 ตารางสรุปย้อนหลัง (เทียบหลายครั้ง)</button>
    <p class="mute" style="text-align:center;margin:0 0 4px">กด ‹ › (หรือปัดซ้าย-ขวา) เพื่อดูค่าครั้งก่อน · แตะที่รายการเพื่อดูกราฟ</p>${rows || '<p class="mute" style="text-align:center">รายการที่มีข้อมูลถูกซ่อนไว้ทั้งหมด — เปิดได้ในหน้าตั้งค่า</p>'}${dhtml}
    <p class="mute">ช่วงค่าอ้างอิงเป็นค่าทั่วไป อาจต่างจากแล็บหรือเป้าหมายที่แพทย์กำหนด ใช้เพื่อติดตามเท่านั้น ไม่ใช่การวินิจฉัย</p>`;
}
const quickBar = () => `<div class="quick">${Object.entries(QUICK).map(([k, q]) => `<button class="btn" data-act="quick" data-id="${k}">+ ${q.label}</button>`).join('')}</div>`;

/** ค่าที่คำนวณจากข้อมูลล่าสุด (ไม่ได้เก็บลงฐานข้อมูล คำนวณใหม่ทุกครั้งที่แสดง) */
function derived() {
  const out = [], p = prof(), last = id => series(id).pop();
  const cr = last('cr');
  if (cr && !('egfr' in cr.rec.values)) {                 // ถ้าใบแล็บครั้งนั้นให้ eGFR มาแล้ว ใช้ค่าของแล็บ ไม่คำนวณซ้ำ
    const age = ageOf(p.dob, cr.date);
    if (p.sex && age != null && age >= 18) {
      const F = p.sex === 'f', k = F ? 0.7 : 0.9, a = F ? -0.241 : -0.302;                 // CKD-EPI 2021 (ไม่ใช้เชื้อชาติ), Creatinine หน่วย mg/dL
      const v = Math.round(142 * Math.min(cr.v / k, 1) ** a * Math.max(cr.v / k, 1) ** -1.2 * 0.9938 ** age * (F ? 1.012 : 1));
      out.push({ name: 'อัตราการกรองของไต (eGFR)', sub: `สูตร CKD-EPI 2021 จาก Creatinine ${fmtNum(cr.v)} · อายุ ${age} ปี · เพศ${SEX_TH[p.sex]}`, v, unit: 'mL/min/1.73m²', st: statusOf(testById('egfr'), v), date: cr.date });
    } else out.push({ hint: 'ใส่เพศและวันเกิดในโปรไฟล์ เพื่อให้แอปคำนวณอัตราการกรองของไต (eGFR) จากค่า Creatinine' });
  }
  const lip = myRecords('lab').filter(r => 'chol' in r.values && 'hdl' in r.values).pop();
  if (lip) {
    const { chol, hdl, tg } = lip.values, non = chol - hdl;
    out.push({ name: 'ไขมันที่ไม่ใช่ HDL (Non-HDL)', sub: 'คอเลสเตอรอลรวม − HDL · เกณฑ์ทั่วไป ≤ 160', v: non, unit: 'mg/dL', st: non > 160 ? 'high' : 'ok', date: lip.date });
    if (!('ldl' in lip.values) && tg != null && tg < 400) { const v = Math.round(non - tg / 5); out.push({ name: 'ไขมันไม่ดี LDL (คำนวณ)', sub: 'สูตร Friedewald: รวม − HDL − ไตรกลีเซอไรด์/5', v, unit: 'mg/dL', st: statusOf(testById('ldl'), v), date: lip.date }); }
  }
  const w = last('waist');
  if (w && p.height) { const v = +(w.v / p.height).toFixed(2); out.push({ name: 'รอบเอวต่อส่วนสูง', sub: 'เกณฑ์ < 0.5 (รอบเอวไม่ควรเกินครึ่งของส่วนสูง)', v, unit: '', st: v >= 0.5 ? 'high' : 'ok', date: w.date }); }
  const wh = myRecords('body').filter(r => 'waist' in r.values && r.values.hip > 0).pop();
  if (wh) {
    const v = +(wh.values.waist / wh.values.hip).toFixed(2), lim = p.sex === 'm' ? 0.9 : p.sex === 'f' ? 0.85 : null;
    out.push({ name: 'รอบเอวต่อรอบสะโพก', sub: lim ? `เกณฑ์ < ${lim} (เพศ${SEX_TH[p.sex]})` : 'ระบุเพศในโปรไฟล์เพื่อดูเกณฑ์', v, unit: '', st: lim ? (v >= lim ? 'high' : 'ok') : '', date: wh.date });
  }
  return out;
}

/** หน้าแรกแบบง่าย (โหมดผู้สูงอายุ): 3 การ์ดใหญ่ ค่าล่าสุด + ปุ่มบันทึก */
function viewSimple() {
  const bp = bpSessions().pop(), wt = series('weight').pop();
  const sg = ['dtx_f', 'dtx_pp'].map(id => ({ id, s: series(id).pop() })).filter(x => x.s).sort((a, b) => a.s.ts - b.s.ts).pop();
  const card = (key, title, has, val, unit, st, when, trendId) => `<div class="card big">
      <div class="bt">${title}</div>
      ${has ? `<div class="bv">${val} <small>${esc(unit)}</small> ${chip(st)}</div><div class="mute">ล่าสุด ${when}</div>` : '<div class="mute">ยังไม่เคยบันทึก</div>'}
      <button class="btn primary block xl" data-act="quick" data-id="${key}">＋ บันทึก${QUICK[key].label}</button>
      ${has ? `<button class="btn block" data-act="trend" data-id="${trendId}">ดูย้อนหลัง</button>` : ''}</div>`;
  const when = (date, time) => fmtDate(date, true) + (time ? ` ${esc(time)} น.` : '');
  return `<p class="mute" style="margin:0 2px 10px;font-size:1rem">สวัสดี ${esc(prof().name)}</p>
    ${card('bp', 'ความดัน', !!bp, bp ? `${bp.sys}/${bp.dia}` : '', 'mmHg', bp ? bpStatus(bp.sys, bp.dia) : '', bp ? when(bp.date, bp.time) : '', 'bp')}
    ${card('weight', 'น้ำหนัก', !!wt, wt ? fmtNum(wt.v) : '', 'กก.', '', wt ? when(wt.date, wt.rec.time) : '', 'weight')}
    ${card('sugar', 'น้ำตาลปลายนิ้ว', !!sg, sg ? fmtNum(sg.s.v) : '', 'mg/dL' + (sg ? (sg.id === 'dtx_f' ? ' · ก่อนอาหาร' : ' · หลังอาหาร') : ''), sg ? statusOf(testById(sg.id), sg.s.v) : '', sg ? when(sg.s.date, sg.s.rec.time) : '', sg ? sg.id : '')}
    <button class="btn block" data-act="care" style="margin-top:20px">⚙️ สำหรับผู้ดูแล — ดูข้อมูลทั้งหมด / ตั้งค่า</button>`;
}

/** ตารางเทียบหลายครั้ง ใช้ร่วมกันทั้งในแอป (print=false) และ PDF (print=true) */
function tableHTML(kind, cols, print) {
  let body = '';
  for (const [g, tests] of groups(kind)) {
    const used = tests.filter(t => cols.some(r => t.id in r.values)); if (!used.length) continue;
    body += `<tr class="grp"><td colspan="${cols.length + (print ? 3 : 1)}">${esc(g)}</td></tr>` + used.map(t =>
      (print ? `<tr><td>${esc(t.th ? t.th + ' (' + t.name + ')' : t.name)}</td><td>${esc(t.unit)}</td><td>${esc(rangeText(t))}</td>`
        : `<tr><td><b>${esc(t.th || t.name)}</b><div class="mute">${esc([t.th ? t.name : '', t.unit, rangeText(t)].filter(Boolean).join(' · '))}</div></td>`) +
      cols.map(r => { if (!(t.id in r.values)) return '<td></td>'; const v = r.values[t.id], st = statusOf(t, v); return st === 'high' || st === 'low' ? `<td class="abn ${st}">${fmtNum(v)} ${st === 'high' ? '↑' : '↓'}</td>` : `<td>${fmtNum(v)}</td>`; }).join('') + '</tr>').join('');
  }
  return `<table class="${print ? '' : 'sum'}"><tr><th>รายการ</th>${print ? '<th>หน่วย</th><th>เกณฑ์อ้างอิง</th>' : ''}${cols.map(r => `<th>${fmtDate(r.date)}<br><small>${esc(kind === 'body' ? (r.time || '') : (r.lab || ''))}</small></th>`).join('')}</tr>${body}</table>`;
}
function viewSummary() {
  const kind = ui.sumKind === 'body' ? 'body' : 'lab', recs = myRecords(kind), cols = recs.slice(-12).reverse();
  const seg = [['lab', '🩸 ผลเลือด'], ['body', '📏 ร่างกาย']].map(([k, l]) => `<button class="btn" data-act="sumKind" data-id="${k}" aria-pressed="${kind === k}">${l}</button>`).join('');
  return `<h2>ตารางสรุปย้อนหลัง</h2><div class="seg">${seg}</div>` + (cols.length
    ? `<p class="mute" style="margin:0 2px 8px">ครั้งล่าสุดอยู่ซ้ายสุด เลื่อนไปทางขวาเพื่อดูครั้งก่อน ๆ · แสดง ${cols.length} จาก ${recs.length} ครั้ง · ↑ สูงกว่าเกณฑ์ ↓ ต่ำกว่าเกณฑ์</p>
      <div class="card scrollx">${tableHTML(kind, cols, false)}</div>`
    : '<p class="mute">ยังไม่มีข้อมูลประเภทนี้</p>') + `
    <div class="btns"><button class="btn" data-act="home">‹ กลับ</button><button class="btn" data-act="pdf">🖨️ ส่งออกเป็น PDF</button></div>`;
}

function viewHistory() {
  if (!myRecords().length) return emptyState();
  const recs = myRecords(ui.hist === 'all' ? null : ui.hist).reverse();
  const seg = [['all', 'ทั้งหมด'], ['lab', '🩸 ผลเลือด'], ['body', '📏 ร่างกาย']].map(([k, l]) => `<button class="btn" data-act="hist" data-id="${k}" aria-pressed="${ui.hist === k}">${l}</button>`).join('');
  return `<h2>ประวัติ</h2><div class="seg">${seg}</div>` + (recs.length ? `<div class="card">` + recs.map(r => {
    const ids = Object.keys(r.values).filter(testById);
    const abn = ids.filter(id => ['low', 'high'].includes(statusOf(testById(id), r.values[id]))).length;
    const sub = r.kind === 'body'
      ? bodyLabel(r, ids)
      : `${r.lab || 'ไม่ระบุสถานที่'} · ${ids.length} รายการ`;
    return `<button class="row" data-act="edit" data-id="${esc(r.id)}"><span>${KIND_ICON[r.kind]}</span><span class="grow"><div><b>${fmtDate(r.date, true)}</b>${r.time ? ` <span class="mute">${esc(r.time)} น.</span>` : ''}</div>
      <div class="mute">${esc(sub)}</div></span>
      ${abn ? `<span class="chip high">นอกเกณฑ์ ${abn}</span>` : '<span class="chip ok">ปกติ</span>'}<span class="mute">›</span></button>`;
  }).join('') + `</div>` : '<p class="mute">ยังไม่มีรายการประเภทนี้</p>');
}

function bodyLabel(r, ids) {
  const parts = [], pair = 'sys' in r.values && 'dia' in r.values;
  if (pair) parts.push(`ความดัน ${fmtNum(r.values.sys)}/${fmtNum(r.values.dia)}`);
  for (const id of ids) if (!(pair && (id === 'sys' || id === 'dia'))) parts.push(`${testById(id).name.replace(/\s*[\/(].*$/, '')} ${fmtNum(r.values[id])}`);
  return parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ` +${parts.length - 3}` : '');
}

/** lines: [{ s:[{ts,v,date}], st: v=>สถานะ, dash }]  opt: { band:{low,high}, marks:[ค่าเส้นเกณฑ์], label } */
function chartSVG(lines, opt = {}) {
  const W = 340, H = 200, L = 42, R = 12, T = 12, B = 26, band = opt.band || {}, marks = (opt.marks || []).filter(v => v != null);
  const all = lines.flatMap(l => l.s), ts = all.map(p => p.ts);
  const lim = [...all.map(p => p.v), ...marks, ...[band.low, band.high].filter(v => v != null)];
  let lo = Math.min(...lim), hi = Math.max(...lim);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.12; lo -= pad; hi += pad;
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const x = tt => t1 === t0 ? (L + W - R) / 2 : L + (tt - t0) / (t1 - t0) * (W - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  let o = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟแนวโน้ม ${esc(opt.label || '')}">`;
  if (band.low != null || band.high != null) {
    const yt = band.high != null ? y(band.high) : T, yb = band.low != null ? y(band.low) : H - B;
    o += `<rect x="${L}" y="${yt}" width="${W - L - R}" height="${Math.max(0, yb - yt)}" fill="var(--ok)" opacity=".13"/>`;
  }
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, yy = y(v);
    o += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="${L - 5}" y="${yy + 4}" text-anchor="end">${fmtNum(+v.toPrecision(3))}</text>`;
  }
  for (const m of marks) o += `<line x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}" stroke="var(--hi)" stroke-dasharray="2 4" opacity=".7"/>`;
  for (const l of lines) {
    const pts = l.s.map(p => [x(p.ts), y(p.v)]);
    if (pts.length > 1) o += `<polyline fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"${l.dash ? ' stroke-dasharray="5 4"' : ''} points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"/>`;
    l.s.forEach((p, i) => {
      const st = l.st(p.v), c = st === 'high' ? 'var(--hi)' : st === 'low' ? 'var(--lo)' : st === 'ok' ? 'var(--ok)' : 'var(--ink)';
      o += `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="${l.s.length > 40 ? 3 : 4.5}" fill="${c}" stroke="var(--card)" stroke-width="1.5"><title>${fmtDate(p.date)}: ${fmtNum(p.v)}</title></circle>`;
    });
  }
  const first = all.reduce((a, p) => p.ts < a.ts ? p : a), last = all.reduce((a, p) => p.ts > a.ts ? p : a);
  o += t1 === t0 ? `<text x="${x(t0)}" y="${H - 8}" text-anchor="middle">${fmtDate(first.date)}</text>`
    : `<text x="${L}" y="${H - 8}" text-anchor="start">${fmtDate(first.date)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end">${fmtDate(last.date)}</text>`;
  return o + '</svg>';
}

function viewTrend() {
  const hasBP = bpSessions().length > 0;
  const withData = [...groups().values()].flat().filter(t => series(t.id).length && !(hasBP && pairOf(t.id) && !bpLone(t.id)));
  if (!withData.length && !hasBP) return emptyState();
  const valid = id => (id === 'bp' && hasBP) || withData.some(t => t.id === id);
  if (!valid(ui.trendTest)) ui.trendTest = hasBP ? 'bp' : withData[0].id;
  const id = ui.trendTest, pinT = testById(id === 'bp' ? 'sys' : id);
  const opts = k => (k === 'body' && hasBP ? `<option value="bp"${id === 'bp' ? ' selected' : ''}>ความดัน ตัวบน/ตัวล่าง (${bpSessions().length})</option>` : '')
    + withData.filter(x => x.kind === k).map(x => `<option value="${esc(x.id)}"${x.id === id ? ' selected' : ''}>${esc(x.th ? x.th + ' — ' + x.name : x.name)} (${series(x.id).length})</option>`).join('');
  return `${simpleActive() ? '<button class="btn block" data-act="home" style="margin:0 0 10px">‹ กลับหน้าหลัก</button>' : ''}<label for="trendSel">รายการ</label>
    <select id="trendSel">${['body', 'lab'].map(k => opts(k) ? `<optgroup label="${KIND_TH[k]}">${opts(k)}</optgroup>` : '').join('')}</select>
    ${id === 'bp' ? trendBP() : trendOne(testById(id))}
    ${simpleActive() ? '' : `<button class="btn block" data-act="pin" data-id="${esc(pinT.id)}">${pinT.pin ? '📌 เลิกปักหมุด' : '📌 ปักหมุดไว้บนสุดของหน้าภาพรวม'}</button>`}`;
}
function trendOne(t) {
  const s = series(t.id);
  const rows = s.slice().reverse().map((p, i, arr) => {
    const prev = arr[i + 1], d = prev ? p.v - prev.v : null;
    return `<tr><td>${fmtDate(p.date, true)}${p.rec.time ? ` <span class="mute">${esc(p.rec.time)}</span>` : ''}</td><td><b>${fmtNum(p.v)}</b></td><td class="mute">${d == null ? '' : d === 0 ? '→' : (d > 0 ? '▲ ' : '▼ ') + fmtNum(Math.abs(d))}</td><td>${chip(statusOf(t, p.v))}</td></tr>`;
  }).join('');
  return `<div class="card" style="margin-top:12px"><div><b>${esc(t.th || t.name)}</b></div><div class="mute">${t.th ? esc(t.name) + ' · ' : ''}${esc(t.unit)}${rangeText(t) ? ' · เกณฑ์ ' + esc(rangeText(t)) + ' (แถบสีเขียว)' : ''}</div>${chartSVG([{ s, st: v => statusOf(t, v) }], { band: rng(t), label: t.name })}</div>
    <div class="card"><table><tr><th>วันที่</th><th>ค่า</th><th>เปลี่ยนแปลง</th><th></th></tr>${rows}</table></div>`;
}
function trendBP() {
  const s = bpSessions(), ts = testById('sys'), td = testById('dia');
  const avg = (d, label) => { const a = bpAvg(d); return `<div class="card"><b style="font-size:1.25rem">${a ? `${a.sys}/${a.dia}` : '–'}</b><span class="mute">${label}${a ? ` · ${a.n} ครั้ง` : ''}</span>${a ? '<br>' + chip(bpStatus(a.sys, a.dia)) : ''}</div>`; };
  const rows = s.slice().reverse().map(x => `<tr><td>${fmtDate(x.date, true)}${x.time ? ` <span class="mute">${esc(x.time)}</span>` : ''}</td><td><b>${x.sys}/${x.dia}</b></td><td class="mute">${x.n > 1 ? `เฉลี่ย ${x.n} ครั้ง` : ''}</td><td>${chip(bpStatus(x.sys, x.dia))}</td></tr>`).join('');
  return `<div class="summary" style="margin-top:12px">${avg(7, 'เฉลี่ย 7 วัน')}${avg(30, 'เฉลี่ย 30 วัน')}</div>
    <div class="card"><div class="mute">ความดัน · mmHg · เส้นทึบ = ตัวบน · เส้นประ = ตัวล่าง · เส้นจุดแดง = เกณฑ์สูงสุด (${rng(ts).high ?? '–'}/${rng(td).high ?? '–'})</div>
      ${chartSVG([{ s: s.map(x => ({ ts: x.ts, v: x.sys, date: x.date })), st: v => statusOf(ts, v) }, { s: s.map(x => ({ ts: x.ts, v: x.dia, date: x.date })), st: v => statusOf(td, v), dash: true }], { marks: [rng(ts).high, rng(td).high], label: 'ความดัน' })}</div>
    <div class="card"><table><tr><th>วันที่</th><th>ตัวบน/ตัวล่าง</th><th></th><th></th></tr>${rows}</table>
      <p class="mute">การวัดที่ห่างกันไม่เกิน 10 นาทีในวันเดียวกันนับเป็นรอบเดียวและแสดงค่าเฉลี่ย · ค่าเฉลี่ย 7/30 วันคิดจากทุกครั้งที่วัด</p></div>`;
}

const OCR_IDLE = 'รูปและไฟล์ถูกประมวลผลในเครื่องนี้เท่านั้น ไม่ถูกส่งออกไปที่ใด';
/** หน้าตรวจค่าที่ OCR/PDF อ่านได้: ติ๊กเลือกค่าที่จะนำเข้า แก้ตัวเลขได้ ยังไม่มีอะไรเข้าฟอร์มจนกว่าจะกด "นำเข้า" */
function viewReview(d) {
  const rv = d.review, nSus = rv.items.filter(i => i.sus).length;
  return `<h2>ตรวจค่าที่อ่านได้ก่อนนำเข้า</h2>
    <p class="mute" style="margin:0 2px 8px">${rv.fromText ? 'อ่านจากข้อความในไฟล์ PDF' : 'อ่านจากรูป'}ได้ ${rv.items.length} รายการ · ติ๊กเฉพาะค่าที่ต้องการ · แก้ตัวเลขได้ถ้าไม่ตรงกับใบจริง</p>
    ${nSus ? `<div class="card warn"><b>⚠️ มี ${nSus} ค่าที่ผิดปกติมาก</b><div class="mute">อาจอ่านจุดทศนิยมพลาด (เช่น 5.9 เป็น 59) จึงยังไม่ได้ติ๊กให้ แก้ตัวเลขให้ถูกแล้วค่านั้นจะถูกติ๊กเอง</div></div>` : ''}
    <div class="seg"><button class="btn" data-act="revAll">☑ เลือกทั้งหมด</button><button class="btn" data-act="revNone">☐ ไม่เลือกเลย</button></div>
    ${rv.date ? `<div class="card"><div class="rev"><input type="checkbox" id="revDateOn" checked aria-label="ใช้วันที่ตรวจที่อ่านได้"><span class="grow"><b>วันที่ตรวจ</b><div class="mute">อ่านจากใบผล (เดิมในฟอร์ม ${fmtDate(d.date)})</div></span><input type="date" id="revDate" value="${esc(rv.date)}" max="${today()}" aria-label="วันที่ตรวจ"></div></div>` : ''}
    ${rv.table && rv.table.labels.length > 1 ? `<div class="card"><b>ใบนี้เป็นตารางเทียบหลายปี (${rv.table.labels.map(esc).join(', ')})</b><div class="mute">นำเข้าเฉพาะคอลัมน์ผลปัจจุบัน <b>${esc(rv.table.current)}</b> · รายการที่ปีนี้ไม่ได้ตรวจจะไม่ถูกนำเข้า แม้ใบจะแสดงค่าของปีก่อน</div></div>` : ''}
    ${[false, true].map(isBody => { const list = rv.items.filter(i => !!i.body === isBody); return !list.length ? '' : `${isBody ? '<h2>วัดร่างกาย <span class="mute" style="font-weight:400">— จะบันทึกเป็นรายการแยก วันเดียวกัน</span></h2>' : ''}<div class="card">${list.map(it => {
      const t = testById(it.id), old = it.body ? null : d.values[it.id];
      return `<div class="rev${it.sus ? ' sus' : ''}"><input type="checkbox" data-rev="${esc(it.id)}"${it.sus ? '' : ' checked'} aria-label="นำเข้า ${esc(t.th || t.name)}">
        <span class="grow"><b>${esc(t.th || t.name)}</b><div class="mute">${esc([t.th ? t.name : '', t.unit, rangeText(t) ? 'เกณฑ์ ' + rangeText(t) : ''].filter(Boolean).join(' · '))}${old != null && old !== it.v ? ` · <b>จะแทนค่าเดิม ${fmtNum(old)}</b>` : ''}${it.sus ? ' · <b style="color:var(--hi)">ผิดปกติมาก ตรวจจุดทศนิยม</b>' : ''}</div></span>
        <input type="number" inputmode="decimal" step="any" data-revv="${esc(it.id)}" value="${it.v}" aria-label="ค่า ${esc(t.th || t.name)}"></div>`;
    }).join('')}</div>`; }).join('')}
    ${d.ocrText ? `<details><summary>ดูข้อความดิบที่อ่านได้</summary><pre>${esc(d.ocrText)}</pre></details>` : ''}
    <div class="btns savebar"><button class="btn" data-act="revCancel">ยกเลิก</button><button class="btn primary" data-act="revApply" style="flex:2">✓ นำเข้า <span id="revN">${rv.items.length - nSus}</span> รายการ</button></div>`;
}
function revCount() { const el = $('#revN'); if (el) el.textContent = $$('[data-rev]').filter(c => c.checked).length; }

function viewEdit() {
  if (ui.draft.review) return viewReview(ui.draft);
  const d = ui.draft, body = d.kind === 'body', h = prof().height;
  let fields = '';
  for (const [g, all] of groups(d.kind)) {
    const tests = all.filter(t => d.quick ? QUICK[d.quick].ids.includes(t.id) : (!t.hidden || t.id in d.values));
    if (!tests.length) continue;
    fields += `<h2>${esc(g)}</h2><div class="card">` + tests.map(t => {
      const v = d.values[t.id], auto = t.id === 'bmi' && h, last = series(t.id).filter(x => x.rec.id !== d.id).pop();
      return `<div class="field"><span class="nm">${esc(t.th || t.name)}<span class="rng">${t.th ? esc(t.name) + ' · ' : ''}${esc(t.unit)}${rangeText(t) ? ' · ' + esc(rangeText(t)) : ''}${auto ? ' · คำนวณจากน้ำหนัก' : ''}</span></span>
        <input type="number" inputmode="decimal" step="any" data-test="${esc(t.id)}" value="${v ?? ''}" class="${d.ocr.has(t.id) ? 'ocr' : ''}" aria-label="${esc(t.th || t.name)}"${auto ? ' readonly placeholder="อัตโนมัติ"' : last ? ` placeholder="เดิม ${fmtNum(last.v)}"` : ''}></div>`;
    }).join('') + `</div>`;
  }
  const top = body
    ? `<div class="card"><div class="grid2">
        <div><label for="fDate">วันที่วัด</label><input type="date" id="fDate" value="${esc(d.date)}" max="${today()}"></div>
        <div><label for="fTime">เวลา</label><input type="time" id="fTime" value="${esc(d.time || '')}"></div></div>
        <label for="fNote">บันทึกเพิ่มเติม</label><input id="fNote" value="${esc(d.note)}" placeholder="เช่น หลังตื่นนอน, แขนซ้าย"></div>
        ${h ? '' : '<p class="mute">ใส่ส่วนสูงในโปรไฟล์ (หน้าตั้งค่า) เพื่อให้คำนวณ BMI อัตโนมัติ</p>'}`
    : `<div class="card">
        <div class="btns"><button class="btn primary" data-act="ocrCam">📷 ถ่ายรูปใบผล</button><button class="btn primary" data-act="ocr">🖼️ เลือกรูป / PDF ในเครื่อง</button></div>
        <input type="file" id="ocrCam" accept="image/*" capture="environment" hidden>
        <input type="file" id="ocrFile" accept="image/*,application/pdf,.pdf" hidden>
        <div id="ocrStatus" class="mute" style="margin-top:8px">${d.ocrMsg ? esc(d.ocrMsg) : OCR_IDLE}</div>
        ${d.ocrText ? `<details><summary>ดูข้อความที่อ่านได้</summary><pre>${esc(d.ocrText)}</pre></details>` : ''}
      </div>
      <div class="card"><div class="grid2">
        <div><label for="fDate">วันที่ตรวจ</label><input type="date" id="fDate" value="${esc(d.date)}" max="${today()}"></div>
        <div><label for="fLab">โรงพยาบาล / แล็บ</label><input id="fLab" value="${esc(d.lab)}" placeholder="ไม่บังคับ"></div></div>
        <label for="fNote">บันทึกเพิ่มเติม</label><input id="fNote" value="${esc(d.note)}" placeholder="เช่น งดอาหาร 10 ชม."></div>`;
  return `<h2>${d.quick ? 'บันทึกด่วน: ' + QUICK[d.quick].label : (d.isNew ? 'เพิ่ม' : 'แก้ไข') + (body ? 'การวัดร่างกาย' : 'ผลตรวจเลือด')}</h2>${top}
    ${d.bodyVals && Object.keys(d.bodyVals).length ? `<div class="card"><b>📏 จะบันทึกค่าร่างกายจากใบนี้ด้วย</b><div class="mute">${esc(bodyLabel({ values: d.bodyVals }, Object.keys(d.bodyVals).filter(testById)).replace(/ \+\d+$/, ' …'))} · บันทึกเป็นรายการ "วัดร่างกาย" แยกต่างหาก วันเดียวกับผลเลือด</div>
      <button class="btn block" data-act="dropBody">ไม่บันทึกค่าร่างกาย</button></div>` : ''}
    <p class="mute" style="margin:0 2px">กรอกเฉพาะค่าที่มีในครั้งนี้ ช่องที่เว้นว่างจะไม่ถูกบันทึก (คำว่า "เดิม" สีจางคือค่าครั้งล่าสุด ไม่ใช่ค่าที่กรอก)</p>${fields}
    <div class="btns savebar"><button class="btn" data-act="cancel">ยกเลิก</button><button class="btn primary" data-act="saveRec" style="flex:2">✓ บันทึก</button></div>
    ${d.quick === 'bp' ? '<button class="btn block" data-act="saveAgain">บันทึก แล้ววัดอีกครั้ง (เพื่อหาค่าเฉลี่ย)</button>' : ''}${d.quick && !simpleActive() ? '<button class="btn block" data-act="fullForm">แสดงทุกช่อง</button>' : ''}
    ${d.isNew ? '' : '<button class="btn danger block" data-act="delRec">ลบรายการนี้</button>'}`;
}

function viewSettings() {
  const testList = k => S.tests.filter(t => t.kind === k).map(t => `<div class="row t${t.hidden ? ' off' : ''}">
      <button class="grow link" data-act="editTest" data-id="${esc(t.id)}">${esc(t.th || t.name)}<div class="mute">${t.th ? esc(t.name) + ' · ' : ''}${esc(t.group)} · ${esc(t.unit)}${rangeText(t) ? ' · ' + esc(rangeText(t)) : ''}${t.bySex ? ' · แยกตามเพศ' : ''}</div></button>
      <button class="ib" data-act="pin" data-id="${esc(t.id)}" aria-pressed="${!!t.pin}" aria-label="ปักหมุด ${esc(t.name)}">📌</button>
      <button class="ib" data-act="hideT" data-id="${esc(t.id)}" aria-pressed="${!t.hidden}" aria-label="แสดง ${esc(t.name)}">${t.hidden ? '🚫' : '👁'}</button>
      <button class="ib" data-act="moveT" data-id="${esc(t.id)}:-1" aria-label="เลื่อนขึ้น ${esc(t.name)}">▲</button>
      <button class="ib" data-act="moveT" data-id="${esc(t.id)}:1" aria-label="เลื่อนลง ${esc(t.name)}">▼</button></div>`).join('');
  const sec = Sec.enabled
    ? `<p style="margin-top:0">🔒 <b>เปิดการล็อกอยู่</b> · ข้อมูลในเครื่องถูกเข้ารหัส${Sec.hasBio ? ' · ปลดล็อกด้วยลายนิ้วมือ / Face ID ได้' : ''}</p>
      <button class="btn block" data-act="secLock">🔒 ล็อกเดี๋ยวนี้</button>
      <button class="btn block" data-act="secBio">${Sec.hasBio ? 'ปิดการใช้ลายนิ้วมือ / Face ID' : '👆 เปิดใช้ลายนิ้วมือ / Face ID'}</button>
      <button class="btn block" data-act="secChange">เปลี่ยน PIN</button>
      <button class="btn danger block" data-act="secDisable">ปิดการล็อก (เลิกเข้ารหัส)</button>
      <p class="mute" style="margin-bottom:0">แอปล็อกเองเมื่อปิดหรือสลับไปแอปอื่นเกิน 2 นาที · ถ้าลืม PIN จะเปิดข้อมูลไม่ได้ ต้องกู้คืนจากไฟล์สำรอง</p>`
    : `<p style="margin-top:0">🔓 ยังไม่ได้ล็อก — ใครเปิดเครื่องได้ก็เห็นข้อมูล และข้อมูลในเครื่องยังไม่ได้เข้ารหัส</p>
      <button class="btn primary block" data-act="secEnable">ตั้ง PIN เพื่อล็อกและเข้ารหัสข้อมูล</button>`;
  return `<h2>ความปลอดภัย</h2><div class="card">${sec}</div>
    <h2>โหมดผู้สูงอายุ</h2><div class="card"><p class="mute" style="margin-top:0">หน้าแรกเหลือ 3 ปุ่มใหญ่ (ความดัน น้ำหนัก น้ำตาล) กับค่าล่าสุด ซ่อนเมนูอื่นทั้งหมด ผู้ดูแลกดปุ่ม "สำหรับผู้ดูแล" ที่ท้ายหน้าเพื่อกลับมาตั้งค่าได้</p>
      <button class="btn block${S.simple ? '' : ' primary'}" data-act="simpleToggle" style="margin-top:0">${S.simple ? 'ปิดโหมดผู้สูงอายุ' : 'เปิดโหมดผู้สูงอายุ'}</button>
      ${S.simple ? '<button class="btn primary block" data-act="backSimple">‹ กลับสู่หน้าจอแบบง่าย</button>' : ''}</div>
    <h2>ขนาดตัวอักษร</h2><div class="card"><div class="seg" style="margin:0">${FONT_TH.map((l, i) => `<button class="btn" data-act="font" data-id="${i}" aria-pressed="${(S.font || 0) === i}" style="font-size:${[1, 1.15, 1.3][i]}rem">${l}</button>`).join('')}</div>
      <p class="mute" style="margin-bottom:0">หรือกดปุ่ม "ก+" ที่มุมบนของจอเพื่อสลับขนาดได้ทุกหน้า</p></div>
    <h2>โปรไฟล์</h2><div class="card">${S.profiles.map(p => `<div class="row"><span class="grow">${esc(p.name)}${p.id === S.activeProfile ? ' <span class="chip ok">ใช้งานอยู่</span>' : ''}
      <div class="mute">${esc(profLine(p) || 'ยังไม่ระบุเพศ/วันเกิด/ส่วนสูง')} · ${S.records.filter(r => r.profileId === p.id).length} ครั้ง</div></span>
      <button class="btn" data-act="renProf" data-id="${esc(p.id)}">แก้ไข</button>
      ${S.profiles.length > 1 ? `<button class="btn danger" data-act="delProf" data-id="${esc(p.id)}">ลบ</button>` : ''}</div>`).join('')}
      <button class="btn block" data-act="addProf">+ เพิ่มโปรไฟล์</button></div>
    <h2>ส่งออก / สำรองข้อมูล</h2><div class="card">
      <p style="margin-top:0">สำรองล่าสุด: <b>${S.lastBackup ? fmtDate(S.lastBackup, true) : 'ยังไม่เคยสำรอง'}</b></p>
      <button class="btn block" data-act="export">⬇️ สำรองข้อมูลเป็นไฟล์ (ตั้งรหัสผ่านเข้ารหัสได้)</button>
      <button class="btn block" data-act="import">⬆️ กู้คืนจากไฟล์สำรอง</button>
      <input type="file" id="impFile" accept="application/json,.json" hidden>
      <button class="btn block" data-act="pdf">🖨️ ส่งออกสรุปเป็น PDF (โปรไฟล์ปัจจุบัน)</button>
      <button class="btn block" data-act="summary">📋 ดูตารางสรุปในแอป</button>
      <p class="mute">ข้อมูลทั้งหมดอยู่ในเครื่องนี้เท่านั้น หากล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่อง ข้อมูลจะหาย แอปจะเตือนเมื่อไม่ได้สำรองเกิน 30 วัน</p></div>
    <h2>จัดการรายการ</h2><div class="card">
      <p class="mute" style="margin-top:0">📌 ปักหมุดไว้บนสุดของหน้าภาพรวม · 👁 แสดง/ซ่อนจากหน้าภาพรวมและฟอร์มกรอก (ข้อมูลเดิมไม่หาย) · ▲▼ เลื่อนลำดับในหมวด · แตะชื่อเพื่อแก้เกณฑ์</p>
      <div class="btns"><button class="btn" data-act="hideUnused">ซ่อนรายการที่ยังไม่มีข้อมูล</button><button class="btn" data-act="showAll">แสดงทั้งหมด</button></div></div>
    <h2>รายการวัดร่างกายและเกณฑ์</h2><div class="card">${testList('body')}</div>
    <h2>รายการตรวจเลือดและช่วงค่าอ้างอิง</h2><div class="card">${testList('lab')}
      <button class="btn block" data-act="addTest">+ เพิ่มรายการเอง</button></div>
    <p class="mute">เกณฑ์ที่แสดงเป็นของโปรไฟล์ปัจจุบัน${prof().sex ? ` (เพศ${SEX_TH[prof().sex]})` : ''} · BloodLog ใช้เพื่อบันทึกและติดตามเท่านั้น ไม่ใช่คำแนะนำทางการแพทย์ · OCR โดย Tesseract.js (Apache-2.0)</p>
    <p class="ver">BloodLog ${esc(typeof APP_VERSION === 'string' ? APP_VERSION : '')}</p>`;
}

function viewProf() {
  const p = ui.profDraft, a = ageOf(p.dob);
  return `<h2>${p.isNew ? 'เพิ่มโปรไฟล์' : 'แก้ไขโปรไฟล์'}</h2><div class="card">
    <label for="pName">ชื่อ</label><input id="pName" value="${esc(p.name)}">
    <label for="pSex">เพศ (ใช้เลือกช่วงค่าอ้างอิง)</label>
    <select id="pSex"><option value="">ไม่ระบุ</option><option value="m"${p.sex === 'm' ? ' selected' : ''}>ชาย</option><option value="f"${p.sex === 'f' ? ' selected' : ''}>หญิง</option></select>
    <label for="pDob">วันเกิด${a != null ? ` (อายุ ${a} ปี)` : ''}</label><input id="pDob" type="date" value="${esc(p.dob)}" max="${today()}">
    <label for="pHeight">ส่วนสูง (ซม.) — ใช้คำนวณ BMI</label><input id="pHeight" type="number" inputmode="decimal" step="any" value="${p.height ?? ''}">
    </div>
    <div class="btns"><button class="btn" data-act="cancelTest">ยกเลิก</button><button class="btn primary" data-act="saveProf">บันทึก</button></div>`;
}

function viewTest() {
  const t = ui.testDraft, isNew = !testById(t.id), sx = prof().sex;
  const r = t.bySex && sx ? t.bySex[sx] : t, glist = [...groups(t.kind).keys()];
  return `<h2>${isNew ? 'เพิ่มรายการ' : 'แก้ไขรายการ'}</h2><div class="card">
    <label for="tName">ชื่อรายการ</label><input id="tName" value="${esc(t.name)}">
    ${isNew ? `<label for="tKind">ประเภท</label><select id="tKind"><option value="lab">ผลตรวจเลือด (แล็บ)</option><option value="body">วัดร่างกาย</option></select>` : ''}
    <label for="tGroup">หมวด</label><input id="tGroup" list="glist" value="${esc(t.group)}"><datalist id="glist">${glist.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <label for="tUnit">หน่วย</label><input id="tUnit" value="${esc(t.unit)}">
    ${t.bySex ? `<p class="mute">รายการนี้มีเกณฑ์แยกตามเพศ — ${sx ? `กำลังแก้เกณฑ์สำหรับเพศ${SEX_TH[sx]}` : 'โปรไฟล์นี้ยังไม่ระบุเพศ จึงแก้เกณฑ์ทั่วไป'}</p>` : ''}
    <div class="grid2"><div><label for="tLow">ค่าต่ำสุดปกติ</label><input id="tLow" type="number" inputmode="decimal" step="any" value="${r.low ?? ''}" placeholder="ไม่กำหนด"></div>
    <div><label for="tHigh">ค่าสูงสุดปกติ</label><input id="tHigh" type="number" inputmode="decimal" step="any" value="${r.high ?? ''}" placeholder="ไม่กำหนด"></div></div>
    ${t.kind === 'lab' ? `<label for="tAlias">คำที่ใช้บนใบผลแล็บ (สำหรับ OCR, คั่นด้วยจุลภาค)</label><input id="tAlias" value="${esc((t.aliases || []).join(', '))}" autocapitalize="off">` : ''}
    </div>
    <div class="btns"><button class="btn" data-act="cancelTest">ยกเลิก</button><button class="btn primary" data-act="saveTest">บันทึก</button></div>
    ${!isNew && t.custom ? '<button class="btn danger block" data-act="delTest">ลบรายการนี้</button>' : ''}`;
}

/* ---------- actions ---------- */
function newDraft(rec, kind, quick) {
  ui.back = ui.tab === 'edit' ? ui.back : ui.tab;
  ui.draft = rec
    ? { id: rec.id, isNew: false, kind: rec.kind, date: rec.date, time: rec.time || '', lab: rec.lab || '', note: rec.note || '', values: { ...rec.values }, ocr: new Set() }
    : { id: uid(), isNew: true, kind, date: today(), time: kind === 'body' ? nowTime() : '', lab: '', note: '', values: {}, ocr: new Set(), quick: quick || null };
  ui.tab = 'edit'; render();
  if (quick) { const f = $('input[data-test]:not([readonly])'); if (f) f.focus(); }
}
function readForm() {
  const d = ui.draft;
  if (d.review || !$('#fDate')) return;                // หน้าตรวจค่าไม่มีช่องของฟอร์ม
  d.date = $('#fDate').value || d.date; d.note = $('#fNote').value.trim();
  if ($('#fLab')) d.lab = $('#fLab').value.trim();
  if ($('#fTime')) d.time = $('#fTime').value;
  const vals = { ...d.values };            // ค่าที่ไม่มีช่องบนจอ (เช่นรายการที่ถูกซ่อน) ต้องคงอยู่ ไม่ถูกลบตอนบันทึก
  $$('input[data-test]').forEach(i => { const k = i.dataset.test; if (i.value !== '' && isFinite(+i.value)) vals[k] = +i.value; else delete vals[k]; });
  d.values = vals;
  const h = prof().height;
  if (d.kind === 'body' && h) { if (d.values.weight > 0) d.values.bmi = +(d.values.weight / (h / 100) ** 2).toFixed(1); else delete d.values.bmi; }
}

const actions = {
  new: () => { $('#sheet').hidden = false; },
  closeSheet: () => { $('#sheet').hidden = true; },
  newLab: () => newDraft(null, 'lab'),
  newBody: () => newDraft(null, 'body'),
  async font(n) { S.font = n != null ? +n : ((S.font || 0) + 1) % 3; await save(); render(true); toast('ขนาดตัวอักษร: ' + FONT_TH[S.font]); },
  step: arg => { const [id, d] = arg.split(':'); stepRow(id, +d); },
  quick: id => { if (QUICK[id]) newDraft(null, 'body', id); },
  saveAgain: () => actions.saveRec(null, true),
  fullForm: () => { readForm(); ui.draft.quick = null; render(); },
  // ตัวบน/ตัวล่างแสดงเป็นแถวเดียว จึงปักหมุด/ซ่อนไปด้วยกันเสมอ
  async pin(id) { const t = testById(id), o = testById(pairOf(id)); t.pin = !t.pin; if (o) o.pin = t.pin; await save(); render(true); },
  async hideT(id) { const t = testById(id), o = testById(pairOf(id)); t.hidden = !t.hidden; if (o) o.hidden = t.hidden; await save(); render(true); },
  async moveT(arg) {                 // arg = "<id>:<-1|1>" — เลื่อนลำดับภายในหมวดเดียวกัน
    const [id, dir] = arg.split(':'), i = S.tests.findIndex(t => t.id === id), t = S.tests[i];
    let j = i; do { j += +dir; } while (S.tests[j] && !(S.tests[j].kind === t.kind && S.tests[j].group === t.group));
    if (!S.tests[j]) return;
    [S.tests[i], S.tests[j]] = [S.tests[j], S.tests[i]]; await save(); render(true);
  },
  async hideUnused() {
    const used = new Set(S.records.flatMap(r => Object.keys(r.values)));
    let n = 0; for (const t of S.tests) if (!used.has(t.id) && !t.hidden) { t.hidden = true; n++; }
    await save(); render(true); toast(n ? `ซ่อน ${n} รายการที่ยังไม่มีข้อมูล` : 'ไม่มีรายการให้ซ่อนเพิ่ม');
  },
  async showAll() { for (const t of S.tests) t.hidden = false; await save(); render(true); },
  edit: id => newDraft(S.records.find(r => r.id === id)),
  trend: id => { ui.trendTest = id; ui.tab = 'trend'; render(); },
  hist: k => { ui.hist = k; render(); },
  cancel: () => { ui.tab = ui.back || 'home'; ui.draft = null; render(); },
  async saveRec(_, again) {
    readForm(); const d = ui.draft;
    const bv = d.bodyVals && Object.keys(d.bodyVals).length ? { ...d.bodyVals } : null;
    if (bv && ('sys' in bv) !== ('dia' in bv)) { delete bv.sys; delete bv.dia; }        // ความดันต้องมาเป็นคู่
    const hasBody = bv && Object.keys(bv).length > 0;
    if (!Object.keys(d.values).length && !hasBody) return toast('ยังไม่ได้กรอกค่าใดเลย');
    if (('sys' in d.values) !== ('dia' in d.values)) return toast('กรุณากรอกความดันให้ครบทั้งตัวบนและตัวล่าง');
    if (Object.keys(d.values).length) {
      const rec = { id: d.id, profileId: S.activeProfile, kind: d.kind, date: d.date, lab: d.lab, note: d.note, values: d.values };
      if (d.time) rec.time = d.time;
      const i = S.records.findIndex(r => r.id === d.id);
      if (i >= 0) { rec.profileId = S.records[i].profileId; S.records[i] = rec; } else S.records.push(rec);
    }
    if (hasBody) S.records.push({ id: uid(), profileId: S.activeProfile, kind: 'body', date: d.date, lab: '', note: d.lab ? 'จากใบผลตรวจ ' + d.lab : 'จากใบผลตรวจ', values: bv });   // ค่าร่างกายที่อ่านจากใบผลฉบับเดียวกัน
    await save();
    // ค่าที่กรอกผ่านปุ่มบันทึกด่วนจะถูกเลิกซ่อนอัตโนมัติ ไม่อย่างนั้นบันทึกแล้วจะไม่เห็นบนหน้าภาพรวม
    if (d.quick) { let ch = false; for (const id of QUICK[d.quick].ids) { const t = testById(id); if (t && t.hidden && id in d.values && !(id === 'bmi' && prof().height)) { t.hidden = false; ch = true; } } if (ch) await save(); }
    if (again) { newDraft(null, 'body', d.quick); return toast('บันทึกแล้ว — วัดครั้งถัดไปได้เลย'); }
    ui.tab = 'home'; ui.draft = null; render(); toast('บันทึกแล้ว');
  },
  async delRec() {
    if (!confirm('ลบรายการนี้?')) return;
    const snap = structuredClone(S);
    S.records = S.records.filter(r => r.id !== ui.draft.id); await save(); ui.tab = ui.back || 'history'; ui.draft = null; render();
    offerUndo('ลบรายการแล้ว', snap);
  },
  ocr: () => { readForm(); noLockUntil = Date.now() + 5 * 60e3; $('#ocrFile').click(); },          // เลือกรูปหรือ PDF ที่มีอยู่ในเครื่อง
  ocrCam: () => { readForm(); noLockUntil = Date.now() + 5 * 60e3; $('#ocrCam').click(); },        // เปิดกล้องถ่ายใหม่
  /* ----- หน้าตรวจค่าที่อ่านได้ก่อนนำเข้า ----- */
  dropBody: () => { readForm(); ui.draft.bodyVals = null; render(true); },
  revAll: () => { $$('[data-rev]').forEach(c => { c.checked = true; }); revCount(); },
  revNone: () => { $$('[data-rev]').forEach(c => { c.checked = false; }); revCount(); },
  revCancel: () => { const d = ui.draft; d.review = null; d.ocrMsg = 'ยกเลิกการนำเข้า ไม่มีค่าใดถูกเปลี่ยน'; render(); },
  revApply() {
    const d = ui.draft; let n = 0;
    for (const c of $$('[data-rev]')) {
      if (!c.checked) continue;
      const inp = $(`[data-revv="${CSS.escape(c.dataset.rev)}"]`), v = inp && inp.value !== '' ? +inp.value : NaN;
      if (!isFinite(v)) continue;
      const t = testById(c.dataset.rev); n++;
      if (t && t.kind === 'body') (d.bodyVals = d.bodyVals || {})[t.id] = v;        // ค่าร่างกายจากใบเดียวกัน: เก็บไว้รอบันทึกเป็นรายการแยก
      else { d.values[c.dataset.rev] = v; d.ocr.add(c.dataset.rev); }
    }
    const dOn = $('#revDateOn'), dv = $('#revDate'), useDate = dOn && dOn.checked && dv && /^\d{4}-\d{2}-\d{2}$/.test(dv.value) && dv.value <= today();
    if (useDate) d.date = dv.value;
    d.review = null;
    d.ocrMsg = n ? `นำเข้า ${n} รายการแล้ว (ช่องสีเหลือง)${useDate ? ' พร้อมวันที่ตรวจ' : ''} — แก้ไขต่อได้ แล้วกด "บันทึก" เพื่อเก็บ` : 'ไม่ได้เลือกค่าใด จึงไม่มีอะไรถูกนำเข้า';
    render();
  },
  addProf: () => { ui.ret = ui.tab; ui.profDraft = { id: uid(), isNew: true, name: '', sex: '', dob: '', height: null }; ui.tab = 'prof'; render(); },
  renProf: id => { ui.ret = ui.tab; ui.profDraft = { ...S.profiles.find(x => x.id === id), isNew: false }; ui.tab = 'prof'; render(); },
  async saveProf() {
    const d = ui.profDraft, name = $('#pName').value.trim(); if (!name) return toast('กรุณาใส่ชื่อ');
    const h = +$('#pHeight').value;
    const p = { id: d.id, name, sex: $('#pSex').value, dob: $('#pDob').value, height: h > 0 && isFinite(h) ? h : null };
    const i = S.profiles.findIndex(x => x.id === p.id);
    if (i >= 0) S.profiles[i] = p; else { S.profiles.push(p); S.activeProfile = p.id; }
    await save(); ui.tab = ui.ret || 'settings'; render(); toast('บันทึกแล้ว');
  },
  async delProf(id) {
    const p = S.profiles.find(x => x.id === id), n = S.records.filter(r => r.profileId === id).length;
    if (!confirm(`ลบโปรไฟล์ "${p.name}" และข้อมูล ${n} ครั้งของโปรไฟล์นี้?`)) return;
    const snap = structuredClone(S);
    S.profiles = S.profiles.filter(x => x.id !== id); S.records = S.records.filter(r => r.profileId !== id);
    if (S.activeProfile === id) S.activeProfile = S.profiles[0].id; await save(); render();
    offerUndo(`ลบโปรไฟล์ "${p.name}" แล้ว`, snap);
  },
  addTest: () => { ui.ret = 'settings'; ui.testDraft = { id: 'c_' + uid(), kind: 'lab', name: '', group: 'อื่น ๆ', unit: '', low: null, high: null, aliases: [], custom: true }; ui.tab = 'test'; render(); },
  editTest: id => { ui.ret = 'settings'; ui.testDraft = structuredClone(testById(id)); ui.tab = 'test'; render(); },
  cancelTest: () => { ui.tab = ui.ret || 'settings'; render(); },      // ใช้ร่วมกันทั้งฟอร์มโปรไฟล์และฟอร์มรายการ
  async saveTest() {
    const t = ui.testDraft, num = v => v === '' || !isFinite(+v) ? null : +v, sx = prof().sex;
    t.name = $('#tName').value.trim(); if (!t.name) return toast('กรุณาใส่ชื่อรายการ');
    if ($('#tKind')) t.kind = $('#tKind').value;
    t.group = $('#tGroup').value.trim() || 'อื่น ๆ'; t.unit = $('#tUnit').value.trim();
    const low = num($('#tLow').value), high = num($('#tHigh').value);
    if (low != null && high != null && low > high) return toast('ค่าต่ำสุดต้องไม่มากกว่าค่าสูงสุด');
    if (t.bySex && sx) t.bySex[sx] = { low, high }; else { t.low = low; t.high = high; }
    if ($('#tAlias')) t.aliases = $('#tAlias').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const i = S.tests.findIndex(x => x.id === t.id); if (i >= 0) S.tests[i] = t; else S.tests.push(t);
    await save(); ui.tab = 'settings'; render(); toast('บันทึกแล้ว');
  },
  async delTest() {
    const t = ui.testDraft; if (!confirm(`ลบรายการ "${t.name}" และค่าที่เคยบันทึกไว้ทั้งหมด?`)) return;
    const snap = structuredClone(S);
    S.tests = S.tests.filter(x => x.id !== t.id); for (const r of S.records) delete r.values[t.id];
    await save(); ui.tab = 'settings'; render();
    offerUndo(`ลบรายการ "${t.name}" แล้ว`, snap);
  },
  async export() {
    const pw = await askPassword({ title: 'ตั้งรหัสผ่านไฟล์สำรอง', sub: 'ต้องใช้รหัสนี้ตอนกู้คืน ถ้าลืมจะเปิดไฟล์ไม่ได้ · ยาวอย่างน้อย 8 ตัวอักษร · เว้นว่างไว้ถ้าไม่ต้องการเข้ารหัส', confirm: true, allowEmpty: true, min: 8 });
    if (pw === null) return;
    if (pw === '' && !confirm('ไฟล์สำรองจะไม่ถูกเข้ารหัส ใครได้ไฟล์ไปก็เปิดอ่านข้อมูลสุขภาพได้ ต้องการสำรองแบบไม่เข้ารหัส?')) return;
    const payload = { app: 'bloodlog', exportedAt: new Date().toISOString(), ...S };
    const text = pw ? await Sec.packBackup(payload, pw) : JSON.stringify(payload, null, 2);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = `bloodlog-backup-${today()}${pw ? '-encrypted' : ''}.json`;
    noLockUntil = Date.now() + 5 * 60e3;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    S.lastBackup = today(); S.backupSnooze = null; await save(); render(true);
    toast(pw ? 'สำรองแล้ว (เข้ารหัส) — เก็บไฟล์ไว้นอกเครื่องนี้ด้วย' : 'สำรองแล้ว — เก็บไฟล์ไว้นอกเครื่องนี้ด้วย');
  },
  async snooze() { const d = new Date(Date.now() + 7 * 864e5); S.backupSnooze = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; await save(); render(true); },
  summary: () => { ui.tab = 'summary'; render(); },
  sumKind: k => { ui.sumKind = k; render(true); },
  home: () => { ui.tab = 'home'; render(); },
  care: () => { ui.care = true; ui.tab = 'settings'; render(); },
  backSimple: () => { ui.care = false; ui.tab = 'home'; render(); },
  async simpleToggle() {
    S.simple = !S.simple; ui.care = S.simple;          // เปิดจากหน้าตั้งค่า = ผู้ดูแลกำลังใช้อยู่ ยังเห็นเมนูเต็มจนกว่าจะกด "กลับสู่หน้าจอแบบง่าย"
    if (S.simple && !S.font) S.font = 1;
    await save(); render(true); toast(S.simple ? 'เปิดโหมดผู้สูงอายุแล้ว' : 'ปิดโหมดผู้สูงอายุแล้ว');
  },
  /* ----- ความปลอดภัย ----- */
  async secEnable() {
    if (memOnly) return toast('เครื่องนี้เก็บข้อมูลถาวรไม่ได้ จึงตั้งการล็อกไม่ได้');
    if (!confirm('ถ้าลืม PIN จะเปิดข้อมูลไม่ได้ และไม่มีทางกู้ นอกจากกู้คืนจากไฟล์สำรอง\n\nแนะนำให้สำรองข้อมูลก่อน ต้องการตั้ง PIN ต่อ?')) return;
    const pin = await newPin(); if (!pin) return PinPad.close();
    PinPad.busy('กำลังเข้ารหัสข้อมูล…'); await Sec.enable(pin); await save(); PinPad.close(); render(true);
    toast('เปิดการล็อกแล้ว ข้อมูลในเครื่องถูกเข้ารหัส');
  },
  async secChange() {
    if (!await verifyPin()) return PinPad.close();
    const pin = await newPin(); if (!pin) return PinPad.close();
    PinPad.busy('กำลังเปลี่ยน PIN…'); await Sec.changePin(pin); await save(); PinPad.close(); toast('เปลี่ยน PIN แล้ว');
  },
  async secDisable() {
    if (!await verifyPin()) return PinPad.close();
    PinPad.close();
    if (!confirm('ปิดการล็อก? ข้อมูลในเครื่องจะกลับไปเก็บแบบไม่เข้ารหัส')) return;
    Sec.disable(); await save(); render(true); toast('ปิดการล็อกแล้ว');
  },
  async secBio() {
    if (Sec.hasBio) { Sec.bioDisable(); await save(); render(true); return toast('ปิดการใช้ลายนิ้วมือ / Face ID แล้ว'); }
    if (!await verifyPin()) return PinPad.close();
    PinPad.close(); noLockUntil = Date.now() + 5 * 60e3;
    try { await Sec.bioEnable(); await save(); render(true); toast('เปิดใช้ลายนิ้วมือ / Face ID แล้ว'); }
    catch (e) { toast(e && (e.message === 'noprf' || e.message === 'nosupport') ? 'เครื่องหรือเบราว์เซอร์นี้ยังไม่รองรับการปลดล็อกแบบนี้ ใช้ PIN ได้ตามปกติ' : 'ยังไม่ได้เปิดใช้ (ยกเลิกหรือสแกนไม่สำเร็จ)'); }
  },
  secLock: () => lockNow(),
  import: () => { noLockUntil = Date.now() + 5 * 60e3; $('#impFile').click(); },
  pdf: printSummary,
};

function printTable(kind, maxCols) {
  const recs = myRecords(kind); if (!recs.length) return '';
  const cols = recs.slice(-maxCols);
  return `<h2 style="font-size:13px;margin:12px 0 4px">${KIND_TH[kind]} — ${cols.length} ครั้งล่าสุดจากทั้งหมด ${recs.length} ครั้ง</h2>${tableHTML(kind, cols, true)}`;
}
function printSummary() {
  if (!myRecords().length) return toast('ยังไม่มีข้อมูลให้ส่งออก');
  const p = prof();
  $('#print').innerHTML = `<h1>สรุปผลตรวจสุขภาพย้อนหลัง — ${esc(p.name)}</h1>
    <div>${profLine(p) ? esc(profLine(p)) + ' · ' : ''}พิมพ์เมื่อ ${fmtDate(today(), true)} · ↑ สูงกว่าเกณฑ์ ↓ ต่ำกว่าเกณฑ์</div>
    ${printTable('lab', 8)}${printTable('body', 10)}
    <p>ช่วงค่าอ้างอิงเป็นค่าที่ผู้ใช้ตั้งไว้ในแอป อาจต่างจากเกณฑ์ของห้องปฏิบัติการแต่ละแห่ง</p>`;
  noLockUntil = Date.now() + 5 * 60e3;
  window.print();
}

/* ---------- OCR (Tesseract.js รวมอยู่ใน vendor/ ไม่เรียก CDN ภายนอก) ---------- */
let ocrWorker = null, ocrProgress = () => {};
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลดตัวอ่านข้อความไม่สำเร็จ')); document.head.append(s); });
async function getOcrWorker() {
  if (!window.Tesseract) await loadScript('vendor/tesseract/tesseract.min.js');
  if (!ocrWorker) {
    const u = p => new URL(p, location.href).href;
    ocrWorker = await Tesseract.createWorker(['eng', 'tha'], 1, {        // อ่านทั้งอังกฤษและไทย (โมเดลอยู่ใน vendor/tesseract/lang)
      workerPath: u('vendor/tesseract/worker.min.js'), corePath: u('vendor/tesseract/'), langPath: u('vendor/tesseract/lang'),
      logger: m => ocrProgress(m),
    });
  }
  return ocrWorker;
}
let ocrLangs = 'eng+tha';
/** สลับชุดภาษาของตัวอ่าน (ใช้ worker ตัวเดียว ประหยัดหน่วยความจำ) */
async function ocrWith(langs) {
  const w = await getOcrWorker();
  if (ocrLangs !== langs) { await w.reinitialize(langs.split('+'), 1); ocrLangs = langs; }
  return w;
}
/** อ่านจริง: อังกฤษ + ไทย */
async function ocrCanvas(canvas) { const { data } = await (await ocrWith('eng+tha')).recognize(canvas); return data.text || ''; }
/** อ่านแบบเร็วบนรูปย่อเพื่อหาทิศของรูป — ใช้อังกฤษอย่างเดียว: โมเดลไทย "อ่านออก" แม้รูปตะแคงหรือกลับหัว (ได้อักษรไทยมั่ว ๆ ด้วยความมั่นใจสูง)
    ทำให้ตัดสินทิศผิด ส่วนตัวเลขและหน่วย (mg/dL, %) มีในใบแล็บทุกภาษาและอ่านออกเฉพาะเมื่อรูปตั้งตรง */
async function quickOcr(canvas) { const { data } = await (await ocrWith('eng')).recognize(canvas); return { text: data.text || '', conf: data.confidence || 0 }; }
/** รับไฟล์จากปุ่มถ่ายรูป: PDF ที่มีข้อความ → อ่านตรง ๆ; รูปหรือ PDF สแกน → ครอบตัด แล้ว OCR */
async function handleOcrFile(file) {
  const d = ui.draft, live = () => !!S && ui.tab === 'edit' && ui.draft === d;
  const status = html => { const el = $('#ocrStatus'); if (el && live()) el.innerHTML = html; };
  noLockUntil = Date.now() + 5 * 60e3;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  let fromText = false, table = null;
  try {
    let text = null, canvas = null;
    if (isPdf) {
      status('กำลังเปิดไฟล์ PDF…<progress></progress>');
      const r = await OcrTools.readPdf(file, wrong => askPassword({ title: wrong ? 'รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง' : 'ไฟล์ PDF นี้ตั้งรหัสผ่านไว้', sub: 'โรงพยาบาลมักใช้วันเกิดหรือเลขบัตรประชาชนเป็นรหัส (ดูในอีเมลหรือข้อความที่ส่งไฟล์มา)' }));
      if (r.text) { text = r.text; fromText = true; table = r.table || null; } else canvas = r.canvas;
    } else canvas = await OcrTools.loadImage(file);
    if (text == null) {
      ocrProgress = () => {};
      const cut = await OcrTools.crop(canvas, quickOcr);
      if (!cut) return status(esc(d.ocrMsg || OCR_IDLE));
      status('กำลังเตรียมตัวอ่านข้อความ… (ครั้งแรกอาจใช้เวลาสักครู่)<progress></progress>');
      ocrProgress = m => { const p = $('#ocrStatus progress'); if (m.status === 'recognizing text' && p && live()) { p.previousSibling.textContent = 'กำลังอ่านใบผลแล็บ… '; p.value = m.progress; } };
      text = await ocrCanvas(cut);
    }
    if (!live()) return;
    // ตารางเทียบหลายปี (จาก PDF): อ่านค่าจากคอลัมน์ผลปัจจุบันเท่านั้น ส่วนวันที่หาจากข้อความทั้งฉบับ
    const usable = S.tests.filter(t => !t.hidden);
    const values = BloodParser.parse(table ? table.colText : text, usable).values, date = BloodParser.parseDate(text);
    const n = Object.keys(values).length;
    readForm();                                            // เก็บสิ่งที่ผู้ใช้พิมพ์ระหว่างรอ ก่อนวาดฟอร์มใหม่
    d.ocrText = text;
    if (!n) d.ocrMsg = fromText ? 'ไม่พบรายการตรวจที่รู้จักในไฟล์ PDF นี้ ลองกรอกเอง หรือถ่ายรูปใบผลแทน' : 'ไม่พบรายการตรวจที่รู้จักในรูปนี้ ลองครอบให้พอดีตาราง หมุนให้ตรง หรือถ่ายใหม่ให้ชัดและสว่างขึ้น';
    else d.review = { fromText, date, table: table && { labels: table.labels, current: table.current }, items: Object.entries(values).map(([id, v]) => {
      const r = rng(testById(id));   // ค่าที่ห่างจากเกณฑ์เกิน 5 เท่า มักเกิดจากอ่านจุดทศนิยมหรือหลักตัวเลขพลาด (เช่น 5.9 → 59): ไม่ติ๊กให้ ต้องตรวจเอง
      return { id, v, body: testById(id).kind === 'body', sus: !fromText && ((r.high != null && r.high > 0 && v > r.high * 5) || (r.low != null && r.low > 0 && v < r.low / 5)) };
    }) };
  } catch (e) {
    if (e && e.cancelled) return status(esc(d.ocrMsg || OCR_IDLE));
    if (!live()) return;
    readForm();
    d.ocrMsg = 'อ่านไฟล์ไม่สำเร็จ: ' + (e && e.message || e);
  }
  if (live()) render();
}

/* ---------- ล็อก / ปลดล็อก ---------- */
let vault = null;                    // ข้อมูลที่เข้ารหัสไว้ (มีค่าเฉพาะตอนล็อกอยู่)
let lockFails = 0, hiddenAt = 0, noLockUntil = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function newPin() {
  const a = await PinPad.ask({ title: 'ตั้ง PIN ใหม่', sub: 'ตัวเลข 6–12 หลัก ยิ่งยาวยิ่งปลอดภัย', cancel: true }); if (typeof a !== 'string') return null;
  const b = await PinPad.ask({ title: 'ใส่ PIN ใหม่อีกครั้ง', sub: 'เพื่อยืนยันว่าพิมพ์ถูก', cancel: true }); if (typeof b !== 'string') return null;
  if (a !== b) { PinPad.close(); toast('PIN สองครั้งไม่ตรงกัน ยังไม่มีอะไรเปลี่ยนแปลง'); return null; }
  return a;
}
async function verifyPin() {
  for (let msg = ''; ;) {
    const r = await PinPad.ask({ title: 'ใส่ PIN ปัจจุบัน', cancel: true, msg }); if (typeof r !== 'string') return false;
    PinPad.busy('กำลังตรวจสอบ…'); if (await Sec.checkPin(r)) return true;
    msg = 'PIN ไม่ถูกต้อง';
  }
}
/** แสดงหน้าล็อกจนกว่าจะปลดได้ แล้วโหลดข้อมูลเข้า S (ผู้เรียกเป็นคน render) */
async function unlockFlow() {
  document.body.dataset.locked = 1; document.documentElement.dataset.font = vault.font || 0;
  for (let msg = ''; ;) {
    const r = await PinPad.ask({ title: 'ใส่ PIN เพื่อเปิด BloodLog', sub: Sec.hasBio ? 'หรือแตะปุ่มลายนิ้วมือ / Face ID' : '', bio: Sec.hasBio, forgot: true, msg });
    if (r && r.forgot) {
      if (confirm('ถ้าลืม PIN ไม่มีทางเปิดข้อมูลเดิมได้\n\nทางเดียวคือลบข้อมูลในเครื่องนี้ทั้งหมด แล้วกู้คืนจากไฟล์สำรอง (ถ้ามี)\n\nต้องการลบข้อมูลทั้งหมดในเครื่องนี้?') && confirm('ยืนยันอีกครั้ง: ลบข้อมูลทั้งหมดในเครื่องนี้ถาวร?')) { await Store.del('state'); location.reload(); return new Promise(() => {}); }
      msg = ''; continue;
    }
    const bio = !!(r && r.bio);
    const ac = bio ? new AbortController() : null;
    PinPad.busy(bio ? 'กำลังรอการสแกน…' : 'กำลังตรวจสอบ…', ac && (() => ac.abort()));
    if (bio ? await Sec.unlockBio(ac.signal) : await Sec.unlockPin(r)) {
      try { S = normalize(await Sec.open(vault.data)); break; }
      catch (e) { Sec.lock(); msg = 'เปิดข้อมูลไม่ได้ ข้อมูลในเครื่องอาจเสียหาย'; continue; }
    }
    msg = bio ? 'สแกนไม่สำเร็จ ลองอีกครั้งหรือใช้ PIN' : 'PIN ไม่ถูกต้อง';
    if (!bio && ++lockFails >= 5) for (let s = Math.min(300, 30 * 2 ** (lockFails - 5)); s > 0; s--) { PinPad.busy(`ใส่ผิดหลายครั้ง รอ ${s} วินาที`); await sleep(1000); }
  }
  lockFails = 0; vault = null; PinPad.close(); delete document.body.dataset.locked;
}
async function lockNow() {
  if (!Sec.enabled || !S) return;
  await save(); await saveQ;
  try { vault = await Store.get('state'); } catch (e) { return toast('ล็อกไม่ได้: อ่านข้อมูลที่บันทึกไว้ไม่สำเร็จ'); }
  if (!vault || !vault.vault) return toast('ล็อกไม่ได้: ข้อมูลยังไม่ได้ถูกบันทึกแบบเข้ารหัส');
  S = null; Sec.lock();
  ui = { tab: 'home', trendTest: null, draft: null, hist: 'all', off: {} };
  $('#view').innerHTML = ''; $('#print').innerHTML = '';                 // ไม่ทิ้งข้อมูลไว้ในหน้าเว็บตอนล็อก
  for (const id of ['crop', 'modal', 'sheet']) { $('#' + id).hidden = true; if (id !== 'sheet') $('#' + id).innerHTML = ''; }
  await unlockFlow(); render();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); if (Sec.enabled) document.body.dataset.veil = 1; return; }      // veil: ไม่ให้ข้อมูลค้างในภาพตัวอย่างตอนสลับแอป
  delete document.body.dataset.veil;
  if (Sec.enabled && S && hiddenAt && Date.now() - hiddenAt > 2 * 60e3 && Date.now() > noLockUntil) lockNow();
});

/* ---------- events ---------- */
let sw = null, swipedAt = 0;
document.addEventListener('pointerdown', e => { const r = e.target.closest('[data-swipe]'); sw = r ? { id: r.dataset.swipe, x: e.clientX, y: e.clientY } : null; });
document.addEventListener('pointercancel', () => { sw = null; });
document.addEventListener('pointerup', e => {
  if (!sw) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y, id = sw.id; sw = null;
  if (Math.hypot(dx, dy) > 10) swipedAt = Date.now();          // ลากแล้วปล่อย ไม่นับเป็นการแตะ
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  swipedAt = Date.now(); stepRow(id, dx > 0 ? 1 : -1);
});
document.addEventListener('keydown', e => {
  if (e.target.matches && e.target.matches('[data-swipe]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return actions.trend(e.target.dataset.swipe); }
  const r = e.target.closest && e.target.closest('[data-swipe]');
  if (S && r && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); stepRow(r.dataset.swipe, e.key === 'ArrowLeft' ? 1 : -1); }
});
document.addEventListener('click', e => {
  if (!S) return;                                                      // ล็อกอยู่: หน้าล็อกจัดการคลิกเอง
  if (Date.now() - swipedAt < 400) { e.preventDefault(); return; }     // การปัดไม่นับเป็นการแตะ
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) { if (b.tagName === 'A') e.preventDefault(); return actions[b.dataset.act](b.dataset.id); }
  if (e.target.id === 'sheet') return actions.closeSheet();
  const n = e.target.closest('nav button'); if (n) { ui.tab = n.dataset.tab; ui.draft = null; ui.off = {}; render(); }
});
$('#fab').addEventListener('click', () => { if (S) actions.new(); });
$('#profileSel').addEventListener('change', async e => { if (!S) return; S.activeProfile = e.target.value; ui.off = {}; await save(); if (['edit', 'test', 'prof'].includes(ui.tab)) ui.tab = 'home'; render(); });
document.addEventListener('input', e => {       // แก้ตัวเลขในหน้าตรวจค่า = ตั้งใจจะนำเข้าค่านั้น → ติ๊กให้
  if (S && e.target.dataset && e.target.dataset.revv) { const c = $(`[data-rev="${CSS.escape(e.target.dataset.revv)}"]`); if (c && e.target.value !== '') { c.checked = true; revCount(); } }
});
document.addEventListener('input', e => {       // แสดง BMI ทันทีระหว่างพิมพ์น้ำหนัก
  if (S && e.target.dataset && e.target.dataset.test === 'weight') {
    const h = prof().height, b = $('input[data-test="bmi"]'), w = +e.target.value;
    if (h && b) b.value = w > 0 ? (w / (h / 100) ** 2).toFixed(1) : '';
  }
});
document.addEventListener('change', async e => {
  if (!S) return;
  if (e.target.id === 'trendSel') { ui.trendTest = e.target.value; render(); }
  if (e.target.dataset && 'rev' in e.target.dataset) revCount();
  if ((e.target.id === 'ocrFile' || e.target.id === 'ocrCam') && e.target.files[0]) { const f = e.target.files[0]; e.target.value = ''; handleOcrFile(f); }
  if (e.target.id === 'impFile' && e.target.files[0]) {
    const file = e.target.files[0]; e.target.value = '';      // ให้เลือกไฟล์เดิมซ้ำได้
    try {
      let raw = JSON.parse(await file.text());
      if (raw && raw.enc) {                                  // ไฟล์สำรองแบบเข้ารหัส
        const pw = await askPassword({ title: 'ใส่รหัสผ่านของไฟล์สำรอง', sub: 'รหัสที่ตั้งไว้ตอนสำรองไฟล์นี้' }); if (pw === null) return;
        try { raw = await Sec.openBackup(raw, pw); } catch (err) { throw new Error('รหัสผ่านไม่ถูกต้อง หรือไฟล์เสียหาย'); }
      }
      const exported = typeof raw.exportedAt === 'string' ? raw.exportedAt.slice(0, 10) : null;
      const data = normalize(raw);
      if (!confirm(`กู้คืนข้อมูล ${data.records.length} ครั้ง จาก ${data.profiles.length} โปรไฟล์? ข้อมูลปัจจุบันในเครื่องจะถูกแทนที่`)) return;
      // ขนาดตัวอักษรและโหมดผู้สูงอายุเป็นค่าของเครื่องนี้ ไม่เอาจากไฟล์ · วันที่สำรองล่าสุด = วันที่ของไฟล์ที่เพิ่งกู้
      S = { v: 2, profiles: data.profiles, activeProfile: data.activeProfile, tests: data.tests, records: data.records, font: S.font, simple: S.simple, created: data.created,
        lastBackup: /^\d{4}-\d{2}-\d{2}$/.test(exported || '') && exported <= today() ? exported : data.lastBackup, backupSnooze: null };
      ui.off = {}; ui.hist = 'all'; ui.trendTest = null;
      if (Store.db) memOnly = false;      // กู้คืนสำเร็จ: กลับมาบันทึกลงเครื่องได้ แม้ก่อนหน้านี้ข้อมูลเดิมจะเปิดไม่ได้
      await save(); render(); toast('กู้คืนข้อมูลแล้ว');
    } catch (err) { toast('กู้คืนไม่สำเร็จ: ' + err.message); }
  }
});

/* ---------- boot ---------- */
(async () => {
  let stored, msg = '';
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;      // มีเวอร์ชันเก่าคุมหน้านี้อยู่ก่อนแล้วหรือไม่
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});   // none: ตรวจ sw.js และ version.js กับเซิร์ฟเวอร์ทุกครั้ง ไม่ใช้แคช HTTP
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {      // เวอร์ชันใหม่เข้าคุมแล้ว: โหลดหน้าใหม่ให้เอง จะได้ไม่ต้องปิด-เปิดแอปสองรอบ
      if (!hadController || reloaded) return;
      if (S && ui.tab === 'edit') return toast('มีเวอร์ชันใหม่ — บันทึกงานนี้ก่อน แล้วปิดและเปิดแอปใหม่');   // ไม่ทิ้งข้อมูลที่กำลังกรอก
      reloaded = true; location.reload();
    });
  }
  try { await Store.open(); stored = await Store.get('state'); }
  catch (e) { memOnly = true; msg = 'เบราว์เซอร์นี้เก็บข้อมูลถาวรไม่ได้ (โหมดส่วนตัว?)'; }
  if (stored && stored.vault) { vault = stored; Sec.load(stored); await unlockFlow(); }       // ข้อมูลถูกเข้ารหัส: ต้องปลดล็อกก่อน
  else {
    try { S = stored ? normalize(stored) : freshState(); }
    catch (e) { memOnly = true; S = freshState(); msg = 'เปิดข้อมูลที่เก็บไว้ไม่ได้ — แอปจะไม่เขียนทับข้อมูลเดิม ลองกู้คืนจากไฟล์สำรอง'; }   // memOnly กันการบันทึกทับ
  }
  if (msg) setTimeout(() => toast(msg), 300);
  render();
  const q = new URLSearchParams(location.search).get('quick');     // จากทางลัดกดค้างที่ไอคอนแอป
  if (QUICK[q]) { history.replaceState(null, '', location.pathname); newDraft(null, 'body', q); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
