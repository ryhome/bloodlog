/* bobolog — รายการตรวจมาตรฐาน + ตัวแปลงข้อความ OCR เป็นค่าผลตรวจ
   ช่วงค่าอ้างอิงเป็นค่าทั่วไปของผู้ใหญ่ แต่ละแล็บ/เพศอาจต่างกัน — แก้ได้ในหน้าตั้งค่า */
'use strict';

const DEFAULT_TESTS = [
  // น้ำตาล
  {id:'glu',   group:'น้ำตาล', name:'Glucose (FBS)', unit:'mg/dL', low:70, high:99, aliases:['fasting blood sugar','fasting plasma glucose','fasting glucose','glucose','fbs','fpg']},
  {id:'hba1c', group:'น้ำตาล', name:'HbA1c', unit:'%', low:null, high:5.6, aliases:['hemoglobin a1c','haemoglobin a1c','hba1c','hb a1c','a1c','hbalc','hbaic','hba1e']},
  // ไขมัน
  {id:'chol',  group:'ไขมัน', name:'Total Cholesterol', unit:'mg/dL', low:null, high:200, aliases:['total cholesterol','cholesterol total','cholesterol','chol']},
  {id:'tg',    group:'ไขมัน', name:'Triglyceride', unit:'mg/dL', low:null, high:150, aliases:['triglycerides','triglyceride','trig','tg']},
  {id:'hdl',   group:'ไขมัน', name:'HDL-C', unit:'mg/dL', low:40, high:null, aliases:['hdl cholesterol','hdl-cholesterol','hdl-c','hdl']},
  {id:'ldl',   group:'ไขมัน', name:'LDL-C', unit:'mg/dL', low:null, high:130, aliases:['ldl cholesterol','ldl-cholesterol','ldl-c','ldl']},
  // ไต
  {id:'bun',   group:'ไต', name:'BUN', unit:'mg/dL', low:7, high:20, aliases:['blood urea nitrogen','bun']},
  {id:'cr',    group:'ไต', name:'Creatinine', unit:'mg/dL', low:0.6, high:1.2, aliases:['creatinine','creat']},
  {id:'egfr',  group:'ไต', name:'eGFR', unit:'mL/min/1.73m²', low:90, high:null, aliases:['egfr','gfr']},
  {id:'uric',  group:'ไต', name:'Uric acid', unit:'mg/dL', low:3.4, high:7.0, aliases:['uric acid','uric']},
  // ตับ
  {id:'ast',   group:'ตับ', name:'AST (SGOT)', unit:'U/L', low:null, high:40, aliases:['sgot','ast']},
  {id:'alt',   group:'ตับ', name:'ALT (SGPT)', unit:'U/L', low:null, high:41, aliases:['sgpt','alt']},
  {id:'alp',   group:'ตับ', name:'ALP', unit:'U/L', low:40, high:129, aliases:['alkaline phosphatase','alk phos','alp']},
  {id:'tbil',  group:'ตับ', name:'Total Bilirubin', unit:'mg/dL', low:0.2, high:1.2, aliases:['total bilirubin','bilirubin total','bilirubin']},
  {id:'dbil',  group:'ตับ', name:'Direct Bilirubin', unit:'mg/dL', low:null, high:0.3, aliases:['direct bilirubin','bilirubin direct']},
  {id:'alb',   group:'ตับ', name:'Albumin', unit:'g/dL', low:3.5, high:5.2, aliases:['albumin']},
  {id:'tp',    group:'ตับ', name:'Total Protein', unit:'g/dL', low:6.6, high:8.3, aliases:['total protein']},
  {id:'glob',  group:'ตับ', name:'Globulin', unit:'g/dL', low:1.5, high:4.5, aliases:['globulin']},
  {id:'ggt',   group:'ตับ', name:'GGT', unit:'U/L', low:null, high:55, aliases:['gamma gt','gamma-gt','gamma glutamyl','ggt']},
  // CBC
  {id:'hb',    group:'ความสมบูรณ์ของเม็ดเลือด (CBC)', name:'Hemoglobin', unit:'g/dL', low:12, high:17.5, aliases:['hemoglobin','haemoglobin','hgb','hb']},
  {id:'hct',   group:'ความสมบูรณ์ของเม็ดเลือด (CBC)', name:'Hematocrit', unit:'%', low:36, high:52, aliases:['hematocrit','haematocrit','hct']},
  {id:'wbc',   group:'ความสมบูรณ์ของเม็ดเลือด (CBC)', name:'WBC', unit:'10³/µL', low:4, high:10, aliases:['white blood cell','wbc count','wbc']},
  {id:'rbc',   group:'ความสมบูรณ์ของเม็ดเลือด (CBC)', name:'RBC', unit:'10⁶/µL', low:4, high:6, aliases:['red blood cell','rbc count','rbc']},
  {id:'plt',   group:'ความสมบูรณ์ของเม็ดเลือด (CBC)', name:'Platelet', unit:'10³/µL', low:150, high:450, aliases:['platelet count','platelets','platelet','plt']},
  {id:'mcv',   group:'ความสมบูรณ์ของเม็ดเลือด (CBC)', name:'MCV', unit:'fL', low:80, high:100, aliases:['mcv']},
  // ไทรอยด์ / อื่น ๆ
  {id:'tsh',   group:'ไทรอยด์', name:'TSH', unit:'mIU/L', low:0.4, high:4.0, aliases:['tsh']},
  {id:'ft4',   group:'ไทรอยด์', name:'Free T4', unit:'ng/dL', low:0.8, high:1.8, aliases:['free t4','ft4']},
  {id:'ft3',   group:'ไทรอยด์', name:'Free T3', unit:'pg/mL', low:2.0, high:4.4, aliases:['free t3','ft3']},
  {id:'vitd',  group:'อื่น ๆ', name:'Vitamin D (25-OH)', unit:'ng/mL', low:30, high:100, aliases:['vitamin d','vit d','25-oh','25 oh']},
  {id:'ca',    group:'อื่น ๆ', name:'Calcium', unit:'mg/dL', low:8.8, high:10.6, aliases:['calcium']},
  {id:'psa',   group:'อื่น ๆ', name:'PSA', unit:'ng/mL', low:null, high:4, aliases:['prostate specific antigen','psa']},
];

// รายการวัดร่างกาย (kind:'body') — บันทึกเองได้บ่อย ๆ แยกจากผลแล็บ
const BODY_TESTS = [
  {id:'sys',    kind:'body', group:'ความดันและชีพจร', name:'ความดันตัวบน (SYS)', unit:'mmHg', low:90, high:129, aliases:['systolic','sys','ความดันโลหิตตัวบน','ความดันตัวบน']},
  {id:'dia',    kind:'body', group:'ความดันและชีพจร', name:'ความดันตัวล่าง (DIA)', unit:'mmHg', low:60, high:84, aliases:['diastolic','dia','ความดันโลหิตตัวล่าง','ความดันตัวล่าง']},
  {id:'hr',     kind:'body', group:'ความดันและชีพจร', name:'ชีพจร / อัตราการเต้นหัวใจ', unit:'ครั้ง/นาที', low:60, high:100, aliases:['pulse','heart rate','ชีพจร','อัตราการเต้นของหัวใจ','อัตราการเต้นหัวใจ']},
  {id:'dtx_f',  kind:'body', group:'น้ำตาลปลายนิ้ว', name:'น้ำตาลก่อนอาหาร / อดอาหาร', unit:'mg/dL', low:70, high:99, aliases:[]},
  {id:'dtx_pp', kind:'body', group:'น้ำตาลปลายนิ้ว', name:'น้ำตาลหลังอาหาร 2 ชม.', unit:'mg/dL', low:70, high:139, aliases:[]},
  {id:'weight', kind:'body', group:'น้ำหนักและสัดส่วน', name:'น้ำหนัก', unit:'กก.', low:null, high:null, aliases:['weight','น้ำหนัก']},
  {id:'bmi',    kind:'body', group:'น้ำหนักและสัดส่วน', name:'BMI', unit:'กก./ม²', low:18.5, high:22.9, aliases:['bmi','body mass index','ดัชนีมวลกาย','ดัชนีมวลรวมร่างกาย']},
  {id:'fat',    kind:'body', group:'น้ำหนักและสัดส่วน', name:'ไขมันในร่างกาย', unit:'%', low:null, high:null, aliases:['body fat','ไขมันในร่างกาย']},
  {id:'chest',  kind:'body', group:'น้ำหนักและสัดส่วน', name:'รอบอก', unit:'ซม.', low:null, high:null, aliases:['รอบอก']},
  {id:'waist',  kind:'body', group:'น้ำหนักและสัดส่วน', name:'รอบเอว', unit:'ซม.', low:null, high:null, aliases:['waist','รอบเอว']},
  {id:'hip',    kind:'body', group:'น้ำหนักและสัดส่วน', name:'รอบสะโพก', unit:'ซม.', low:null, high:null, aliases:['รอบสะโพก']},
];
DEFAULT_TESTS.unshift(...BODY_TESTS);

// ช่วงอ้างอิงที่ต่างกันตามเพศ [low, high] — ใช้เมื่อโปรไฟล์ระบุเพศ
const SEX_RANGES = {
  ggt:   { m:[null, 55],  f:[null, 38] },
  hb:    { m:[13, 17.5],  f:[12, 15.5] },
  hct:   { m:[39, 52],    f:[36, 46] },
  rbc:   { m:[4.5, 5.9],  f:[4.0, 5.2] },
  cr:    { m:[0.7, 1.3],  f:[0.6, 1.1] },
  uric:  { m:[3.4, 7.0],  f:[2.4, 6.0] },
  hdl:   { m:[40, null],  f:[50, null] },
  waist: { m:[null, 90], f:[null, 80] },
};
// ชื่อเรียกภาษาไทยแบบเข้าใจง่าย (แสดงเป็นชื่อหลัก ชื่ออังกฤษตามใบแล็บแสดงเป็นบรรทัดรอง)
const TH_NAMES = {
  glu:'น้ำตาลในเลือด (อดอาหาร)', hba1c:'น้ำตาลสะสม', chol:'คอเลสเตอรอลรวม', tg:'ไตรกลีเซอไรด์', hdl:'ไขมันดี', ldl:'ไขมันไม่ดี',
  bun:'ของเสียในเลือด (ไต)', cr:'ค่าการทำงานของไต', egfr:'อัตราการกรองของไต', uric:'กรดยูริก',
  ast:'เอนไซม์ตับ AST', alt:'เอนไซม์ตับ ALT', alp:'เอนไซม์ตับ/กระดูก ALP', tbil:'บิลิรูบินรวม', dbil:'บิลิรูบินชนิดตรง', alb:'อัลบูมิน (โปรตีนในเลือด)',
  hb:'ความเข้มข้นเลือด (ฮีโมโกลบิน)', hct:'ความเข้มข้นเลือด (ฮีมาโตคริต)', wbc:'เม็ดเลือดขาว', rbc:'เม็ดเลือดแดง', plt:'เกล็ดเลือด', mcv:'ขนาดเม็ดเลือดแดง',
  tsh:'ฮอร์โมนกระตุ้นไทรอยด์', ft4:'ฮอร์โมนไทรอยด์ T4', ft3:'ฮอร์โมนไทรอยด์ T3', vitd:'วิตามินดี',
};
// คำภาษาไทยที่ใบผลตรวจใช้เรียกแต่ละรายการ (สำหรับอ่านใบแล็บ/ใบตรวจสุขภาพที่พิมพ์ชื่อรายการเป็นไทย)
const TH_ALIASES = {
  glu: ['น้ำตาลในเลือดหลังอดอาหาร', 'น้ำตาลหลังอดอาหาร', 'ระดับน้ำตาลในเลือด', 'น้ำตาลในเลือด', 'น้ำตาล'],
  hba1c: ['น้ำตาลเฉลี่ยสะสม', 'น้ำตาลสะสม'],
  chol: ['คอเลสเตอรอลรวม', 'โคเลสเตอรอลรวม', 'ไขมันคอเลสเตอรอล', 'ไขมันโคเลสเตอรอล', 'คอเลสเตอรอล', 'โคเลสเตอรอล', 'ไขมันรวม'],
  tg: ['ไขมันไตรกลีเซอไรด์', 'ไตรกลีเซอไรด์'],
  hdl: ['ไขมันชนิดดี', 'ไขมันความหนาแน่นสูง', 'ไขมันดี'],
  ldl: ['ไขมันชนิดไม่ดี', 'ไขมันชนิดเลว', 'ไขมันความหนาแน่นต่ำ', 'ไขมันไม่ดี', 'ไขมันเลว'],
  bun: ['ยูเรียไนโตรเจน', 'ไนโตรเจนในเลือด'],
  cr: ['ครีเอตินิน', 'ครีเอตินีน', 'ครีอะตินิน', 'ครีอะตินีน'],
  egfr: ['อัตราการกรองของไต', 'ค่าการกรองของไต'],
  uric: ['กรดยูริก', 'กรดยูริค', 'ยูริก', 'ยูริค'],
  alp: ['อัลคาไลน์ฟอสฟาเตส'],
  alb: ['อัลบูมิน'],
  ca: ['แคลเซียม'],
  tbil: ['บิลิรูบินรวม', 'บิลิรูบิน'],
  hb: ['ฮีโมโกลบิน'],
  hct: ['ฮีมาโตคริต', 'ฮีมาโทคริต'],        // ไม่ใส่ "ความเข้มข้นเลือด": ใบตรวจใช้คำนี้กับทั้ง Hb และ Hct
  wbc: ['จำนวนเม็ดเลือดขาว', 'เม็ดเลือดขาว'],
  rbc: ['จำนวนเม็ดเลือดแดง', 'เม็ดเลือดแดง'],
  plt: ['จำนวนเกล็ดเลือด', 'เกล็ดเลือด'],
  tsh: ['ฮอร์โมนกระตุ้นต่อมไทรอยด์', 'ฮอร์โมนกระตุ้นไทรอยด์'],
  vitd: ['วิตามินดี'],
};
for (const t of DEFAULT_TESTS) {
  if (TH_ALIASES[t.id]) t.aliases = t.aliases.concat(TH_ALIASES[t.id]);
  if (TH_NAMES[t.id]) t.th = TH_NAMES[t.id];
  t.kind = t.kind || 'lab';
  const r = SEX_RANGES[t.id];
  if (r) t.bySex = { m:{ low:r.m[0], high:r.m[1] }, f:{ low:r.f[0], high:r.f[1] } };
}

const BloodParser = (() => {
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const NUM = /(?<![A-Za-z0-9.])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/;      // ไม่เอาเลขที่ติดกับตัวอักษร (เช่น A2A, m2)

  const THAI = /[\u0E00-\u0E7F]/;
  const MARKS = /[\u0E47-\u0E4C]/g;        // วรรณยุกต์ ไม้ไต่คู้ การันต์ — OCR ทำหายหรือสลับบ่อย จึงตัดออกทั้งสองฝั่งก่อนเทียบชื่อรายการ
  /** ปรับข้อความก่อนแปล: เลขไทย → เลขอารบิก, สระอำที่ OCR แยกเป็นสองตัว → ตัวเดียว, ตัดอักขระล่องหน */
  function norm(text) {
    return String(text).normalize('NFC').replace(/[๐-๙]/g, c => '๐๑๒๓๔๕๖๗๘๙'.indexOf(c)).replace(/\u0E4D\u0E32/g, '\u0E33').replace(/[\u200B-\u200D\uFEFF\uE000-\uF8FF]/g, '');   // \uE000-\uF8FF: ฟอนต์ไทยใน PDF บางตัวใช้อักขระพิเศษแทนวรรณยุกต์
  }

  function aliasRegex(alias) {
    if (THAI.test(alias))            // ภาษาไทยไม่เว้นวรรคระหว่างคำ และ OCR มักแทรกช่องว่างกลางคำ: ไม่ใช้ขอบคำ และยอมให้มีช่องว่างระหว่างอักษร
      return new RegExp('()(' + [...alias.replace(/\s+/g, '').replace(MARKS, '')].map(c => c === '\u0E33' ? '(?:\u0E33|\u0E4D?\\s*\u0E32)' : reEsc(c)).join('\\s*') + ')');   // สระอำ: OCR/PDF อาจให้เป็น ํ+า หรือ า เฉย ๆ
    const body = reEsc(alias.toLowerCase()).replace(/[\s-]+|\\-/g, '[\\s\\-]*');
    return new RegExp('(^|[^a-z0-9])(' + body + ')(?![a-z0-9])', 'i');
  }

  /** คืน { values:{testId:number}, date:'YYYY-MM-DD'|null } */
  function parse(text, tests) {
    const pairs = [];
    for (const t of tests) {
      const al = (t.aliases && t.aliases.length ? t.aliases : [t.name]).concat(t.name);
      for (const a of new Set(al.map(x => x.toLowerCase().trim()).filter(Boolean)))
        pairs.push({ id: t.id, len: a.length, re: aliasRegex(a), th: THAI.test(a) });
    }
    const values = {};
    text = norm(text);
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/[|_]/g, ' ').replace(MARKS, '').trim();
      // ข้ามบรรทัดที่ชื่อคล้ายแต่ไม่ใช่รายการที่ต้องการ: อัตราส่วน, ผลตรวจปัสสาวะ, ชนิดย่อยของเม็ดเลือดขาว
      if (!line || /non[\s-]*hdl|ratio|urine|urinalysis|\/\s*hpf|ปัสสาวะ|typing|morphology|\bmchc?\b|\brdw\b|\bmpv\b|neutrophil|lymphocyte|monocyte|eosinophil|basophil|นิวโทรฟิล|ลิมโฟไซต์|โมโนไซต์|อีโอซิโนฟิล|เบโซฟิล/i.test(line)) continue;
      // ใบตรวจไทยมักเขียน "คำอธิบายไทย (ชื่ออังกฤษ)": ชื่ออังกฤษเจาะจงกว่า จึงใช้ก่อนถ้ามี (เช่น "ค่าเฉลี่ยปริมาตรเม็ดเลือดแดง (MCV)" ต้องเป็น MCV ไม่ใช่เม็ดเลือดแดง)
      let best = null;
      for (const p of pairs) {
        const m = p.re.exec(line);
        if (!m) continue;
        const pos = m.index + m[1].length, cand = { id: p.id, pos, len: p.len, end: m.index + m[0].length, th: p.th };
        if (!best || (best.th && !cand.th) || (best.th === cand.th && (pos < best.pos || (pos === best.pos && p.len > best.len)))) best = cand;
      }
      if (!best || best.id in values) continue;
      // ตัดข้อความในวงเล็บทิ้ง รวมถึงส่วนท้ายของวงเล็บที่ชื่อรายการอยู่ข้างใน เช่น "(BMI-kg/m 2) 26.1" → " 26.1"
      const rest = line.slice(best.end).replace(/^[^()]*\)/, ' ').replace(/\([^)]*\)/g, ' ');
      const n = NUM.exec(rest);
      if (!n) continue;
      // เลขตัวแรกเป็นส่วนหนึ่งของค่าอ้างอิง ไม่ใช่ผลตรวจ: เป็นช่วง "0.38 - 5.33" หรือมีเครื่องหมาย < > ≤ ≥ นำหน้า → บรรทัดนี้ไม่มีผล
      if (/^\s*[-–—]\s*\d/.test(rest.slice(n.index + n[0].length)) || /[<>≤≥]\s*$/.test(rest.slice(0, n.index))) continue;
      const v = parseFloat(n[0].replace(/,/g, ''));
      if (!isFinite(v)) continue;
      // บางแล็บรายงานเป็นจำนวนเต็มต่อ µL (เช่น WBC 6,800, Platelet 265,000) แต่หน่วยในแอปคือ 10³/µL
      values[best.id] = (best.id === 'wbc' && v >= 500) || (best.id === 'plt' && v >= 5000) ? v / 1000 : v;
    }
    return { values, date: parseDate(text) };
  }

  const sp = w => [...w].map(reEsc).join('\\s*');                                   // ยอมให้มีช่องว่างแทรกระหว่างอักษร
  const ab = (a, b) => sp(a) + '\\s*\\.?\\s*' + sp(b) + '\\s*\\.?';                    // ตัวย่อเดือน เช่น มี.ค. (จุดอาจหาย)
  const TH_MONTHS = [['มกราคม', 'ม', 'ค'], ['กุมภาพันธ์', 'ก', 'พ'], ['มีนาคม', 'มี', 'ค'], ['เมษายน', 'เม', 'ย'], ['พฤษภาคม', 'พ', 'ค'], ['มิถุนายน', 'มิ', 'ย'],
    ['กรกฎาคม', 'ก', 'ค'], ['สิงหาคม', 'ส', 'ค'], ['กันยายน', 'ก', 'ย'], ['ตุลาคม', 'ต', 'ค'], ['พฤศจิกายน', 'พ', 'ย'], ['ธันวาคม', 'ธ', 'ค']].map(([full, a, b]) => sp(full) + '|' + ab(a, b));
  const MON = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

  function parseDate(text) {
    text = norm(text);
    const now = new Date();
    const fixYear = y => {
      y = +y;
      if (y > 2400) return y - 543;                 // พ.ศ.
      if (y < 100) {                                 // ปี 2 หลัก: ค.ศ. หรือ พ.ศ.
        const cy = now.getFullYear() % 100;
        return y <= cy + 1 ? 2000 + y : 2500 + y - 543;
      }
      return y;
    };
    const ok = (y, m, d) => {
      const dt = new Date(y, m - 1, d);
      if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
      if (y < 1990 || dt.getTime() > now.getTime() + 864e5) return null;
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    // ใบแล็บมีหลายวันที่ (วันเกิด, วันเก็บตัวอย่าง, วันรายงาน): เลือกวันที่ล่าสุดที่ไม่อยู่ในอนาคต
    let m, r;
    // ไม่นับวันที่ที่ตามหลังคำว่า วันเกิด / DOB / Birth (ดูข้อความ 28 ตัวอักษรก่อนหน้า โดยไม่สนช่องว่างที่ OCR แทรก)
    // ดูเฉพาะข้อความหลังตัวเลขตัวก่อนหน้า เพื่อไม่ให้ป้ายของวันที่ก่อนหน้ามาปน
    const found = { list: [], push(v) { const before = text.slice(Math.max(0, m.index - 28), m.index).replace(/^.*\d/s, '').replace(/\s+/g, ''); if (!/เกิด|เกด|dob|d\.o\.b|birth/i.test(before)) this.list.push(v); } };
    const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
    while ((m = iso.exec(text))) if ((r = ok(fixYear(m[1]), +m[2], +m[3]))) found.push(r);
    const dmy = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/g;
    while ((m = dmy.exec(text))) if ((r = ok(fixYear(m[3]), +m[2], +m[1]))) found.push(r);
    const dMy = /\b(\d{1,2})[\s\-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?[\s\-]*(\d{4}|\d{2})\b/gi;
    while ((m = dMy.exec(text))) if ((r = ok(fixYear(m[3]), MON[m[2].toLowerCase()], +m[1]))) found.push(r);
    // วันที่แบบไทย: 15 มี.ค. 2569 / 15 มีนาคม พ.ศ. 2569 (ยอมให้ OCR แทรกช่องว่างหรือทำจุดหาย)
    TH_MONTHS.forEach((names, mi) => {
      const re = new RegExp('(?<!\\d)(\\d{1,2})\\s*(?:' + names + ')\\s*(?:พ\\s*\\.?\\s*ศ\\s*\\.?\\s*)?(\\d{4}|\\d{2})(?!\\d)', 'g');
      while ((m = re.exec(text))) if ((r = ok(fixYear(m[2]), mi + 1, +m[1]))) found.push(r);
    });
    return found.list.length ? found.list.sort().pop() : null;
  }

  return { parse, parseDate, norm };
})();

if (typeof module !== 'undefined') module.exports = { DEFAULT_TESTS, BloodParser };
