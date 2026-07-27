// ============================================================
// ข้อมูลเกม — อ้างอิงจากรายการไพ่จริงในกล่อง (53 ใบ) และ side bet 12 ข้อ
// ============================================================

// ---------- มาสคอตและเลน ----------
// ลำดับเลน 0..3 สำคัญมาก เพราะทิศ swerve ของแต่ละตัวถูกออกแบบมาให้
// "ปัดเข้าใน" เสมอเมื่อวิ่งหันหน้าถูกทาง:
//   Gobbler(0)→ขวา→1   Hurley(1)→ขวา→2   Dangle(2)→ซ้าย→1   Mum(3)→ซ้าย→2
// แต่ถ้าโดน Turn Around ทิศจะกลับด้าน ตัวริม (Gobbler, Mum) จะปัดตกขอบทันที
// นี่คือกลไกหลักที่ทำให้เกิด DQ แบบออกนอกสนาม
const MASCOTS = [
  { id: 'gobbler', name: 'Gobbler', th: 'ก็อบเบลอร์', team: 'Glenbrook', color: '#E8712C', lane: 0, swerve: 'R' },
  { id: 'hurley',  name: 'Hurley',  th: 'เฮอร์ลีย์',  team: 'Boxford',   color: '#E4635A', lane: 1, swerve: 'R' },
  { id: 'dangle',  name: 'Dangle',  th: 'แดงเกิล',    team: 'Ashford',   color: '#4E7BD6', lane: 2, swerve: 'L' },
  { id: 'mum',     name: 'Mum',     th: 'มัม',        team: 'Queveland', color: '#B23A5E', lane: 3, swerve: 'L' },
];

// ---------- สนามแข่ง ----------
// ช่อง 0 = ท้ายสนาม (index), ทั้งหมด 14 ช่องเดิน (ช่อง 1-14 ตามคู่มือ = index 0-13)
// เส้นชัยอยู่ระหว่างช่อง 13 กับ 14 → พอถึงช่อง 14 (index 13) = ข้ามเส้นชัยแล้ว (finishAt)
// ตัวละครเริ่มที่ช่อง 3 (index 2) ดาวอยู่ช่อง 1, 8, 13, 14 (index 0, 7, 12, 13) ตำแหน่งเดียวกันทุกเลน
// sectionLines = เส้นขาวทึบที่แบ่งสนาม ใช้ทั้งตอนพับเสื่อและนิยาม "ช่วงสุดท้าย"
// ❌ เส้นแบ่ง (sectionLines/finalStretch) — คู่มือไม่ได้ระบุ กำหนดเองแล้วปรับสมดุลด้วยการจำลอง
const TRACK = {
  length: 14,
  start: 2,
  finishAt: 13,
  sectionLines: [4, 8, 11],
  finalStretch: 11,          // ช่วงสุดท้าย = ตั้งแต่เส้นทึบสุดท้ายถึงเส้นชัย
  stars: {
    0: [0, 7, 12, 13],
    1: [0, 7, 12, 13],
    2: [0, 7, 12, 13],
    3: [0, 7, 12, 13],
  },
};
TRACK.foldLines = TRACK.sectionLines;

// ============================================================
// สำรับไพ่ 53 ใบ
// ============================================================
const c = (target, type, extra = {}) => ({ target, type, ...extra });

// --- ไพ่มาสคอต 44 ใบ (ตัวละ 11 ใบ เหมือนกันหมด ต่างแค่ทิศ swerve) ---
// ใบแรก "Recover Then 2" คือไพ่เริ่มต้นขอบพิเศษ อยู่ในสำรับทุกเกม
function mascotCards(m) {
  return [
    c(m.id, 'recover', { amount: 2, starting: true }),   // ไพ่เริ่มต้น
    c(m.id, 'fall'),
    c(m.id, 'turn'),
    c(m.id, 'move', { amount: 3 }),
    c(m.id, 'move', { amount: 2 }),
    c(m.id, 'move', { amount: -2 }),
    c(m.id, 'star'),
    c(m.id, 'swerve', { amount: 1, dir: m.swerve }),
    c(m.id, 'swerve', { amount: 2, dir: m.swerve }),
    c(m.id, 'swerve', { amount: 3, dir: m.swerve }),
    c(m.id, 'recover', { amount: 1 }),
  ];
}

const ALL_MASCOT_CARDS = MASCOTS.flatMap(mascotCards);
const STARTING_CARDS = ALL_MASCOT_CARDS.filter((x) => x.starting);

// --- ไพ่เขียว 9 ใบ: มีผลทุกตัว ชนกันไม่ได้ ข้ามเส้นชัยไม่ได้ ---
const MULTI_CARDS = [
  c('all', 'multi', { recover: true,  amount: 2 }),
  c('all', 'multi', { recover: true,  amount: 3 }),
  c('all', 'multi', { recover: false, amount: 1 }),
  c('all', 'multi', { recover: false, amount: 1 }),
  c('all', 'multi', { recover: false, amount: 2 }),
  c('all', 'multi', { recover: false, amount: 2 }),
  c('all', 'multi', { recover: false, amount: 3 }),
  c('all', 'multi', { recover: false, amount: 3 }),
  c('all', 'multi', { recover: false, amount: -2 }),
];

// กองสุ่ม = 53 - 4 ใบเริ่มต้น = 49 ใบ
const RANDOM_POOL = [...ALL_MASCOT_CARDS.filter((x) => !x.starting), ...MULTI_CARDS];

// แอบใส่ไพ่ได้คนละ 1 ใบเสมอ (CARDS_TO_SUBMIT) มือละ 3 ใบเสมอ (HAND_SIZE)
// สำรับตอนออกสตาร์ท = 4 ใบเริ่มต้น + ไพ่สุ่ม + ไพ่ที่ทุกคนแอบใส่ (n×1) = 18 ใบเสมอ
const RANDOM_COUNT_BY_PLAYERS = { 2: 12, 3: 11, 4: 10, 5: 9, 6: 8, 7: 7, 8: 6 };
const HAND_SIZE = 3;
const CARDS_TO_SUBMIT = 1;
const TICKETS_PER_RACE = 2;

// ============================================================
// ตั๋วเดิมพัน
// ============================================================
// ที่มาของตัวเลขแต่ละชุด (ตรวจจากรูปในคู่มือโดยตรง):
//   ✅ = อ่านจากรูปตั๋วในคู่มือได้ชัดเจน
//   ⚠️ = เห็นตัวเลขแต่ไม่รู้ว่าเป็นตั๋วขนาดไหน
//   ❌ = ยังไม่มีต้นฉบับ ผมกำหนดเองให้ไล่ระดับลงมาอย่างสมเหตุสมผล
//
// ถ้าอยากให้ตรงกล่องจริง หยิบตั๋วมาดูแล้วแก้เฉพาะบรรทัดที่ ⚠️ กับ ❌
const MASCOT_TICKET_VALUES = {
  // ✅ หน้า 17 — ขอบตั๋วพิมพ์ว่า "TOP BET" ทั้งด้าน Safe และ Risky
  top:    { safe: [10, 7, 5], risky: [15, 5, 2] },
  // ✅ safe: หน้า 26 ตั๋ว MUM ขอบพิมพ์ว่า "MIDDLE BET"
  // ⚠️ risky: หน้า 26 ตั๋ว Dangle แสดง 11/3/1 แต่ขอบด้าน Risky พิมพ์แค่
  //    "RETURN ON REVERSE SIDE" ไม่บอกขนาด — ผมอนุมานว่าเป็นใบกลาง
  //    (เพราะไล่ระดับพอดีระหว่างใบบน 15/5/2 กับใบล่าง)
  middle: { safe: [7, 5, 3],  risky: [11, 3, 1] },
  // ✅ safe: หน้า 27 คำบรรยายใต้รูประบุว่า "Bottom bet pays out as normal"
  // ❌ risky: ไม่มีรูปในคู่มือ ผมกำหนดเอง
  bottom: { safe: [5, 3, 2],  risky: [8, 2, 1] },
};

const SIDE_TICKET_VALUES = {
  // ✅ หน้า 17 (safe 10/0, risky 15/-5) ยืนยันซ้ำที่หน้า 27 และหน้าจัดโต๊ะ
  top:    { safe: [10, 0], risky: [15, -5] },
  // ❌ ทั้งสองบรรทัดล่างไม่มีรูปในคู่มือเลย ผมกำหนดเองโดยล้อระดับของตั๋วมาสคอต
  middle: { safe: [7, 0],  risky: [11, -4] },
  bottom: { safe: [5, 0],  risky: [8, -3] },
};

const SIZES = ['top', 'middle', 'bottom'];

function buildTicketStacks() {
  const stacks = {};
  for (const m of MASCOTS) {
    stacks[m.id] = SIZES.map((size) => ({
      id: `${m.id}-${size}`, kind: 'mascot', mascot: m.id, size,
      values: MASCOT_TICKET_VALUES[size],
    }));
  }
  for (const answer of ['YES', 'NO']) {
    stacks[answer] = SIZES.map((size) => ({
      id: `${answer}-${size}`, kind: 'side', answer, size,
      values: SIDE_TICKET_VALUES[size],
    }));
  }
  return stacks;
}

// ============================================================
// Side Bets 12 ใบ
// ✅ ทั้ง 12 ข้อแปลตรงจากรายการการ์ดที่ได้รับมา ไม่มีข้อไหนแต่งเอง
// ส่วน resolve() คือสูตรตัดสินที่ผมเขียนขึ้นให้ตรงกับข้อความบนการ์ด
// resolve(s) -> true = คำตอบคือ YES
// ============================================================
const bottom2 = (id) => (s) => s.places[id] >= 3;

const SIDE_BETS = [
  { id: 'sb-gobbler', th: 'ก็อบเบลอร์จะจบใน 2 อันดับสุดท้ายไหม?', resolve: bottom2('gobbler') },
  { id: 'sb-mum',     th: 'มัมจะจบใน 2 อันดับสุดท้ายไหม?',        resolve: bottom2('mum') },
  { id: 'sb-hurley',  th: 'เฮอร์ลีย์จะจบใน 2 อันดับสุดท้ายไหม?',   resolve: bottom2('hurley') },
  { id: 'sb-dangle',  th: 'แดงเกิลจะจบใน 2 อันดับสุดท้ายไหม?',     resolve: bottom2('dangle') },
  { id: 'sb-fallen2', th: 'จะมีมาสคอตล้มพร้อมกันตั้งแต่ 2 ตัวไหม?', resolve: (s) => s.twoFallen },
  { id: 'sb-line2',   th: 'จะมีมาสคอต 2 ตัวอยู่ช่องติดเส้นชัยพร้อมกันไหม?', resolve: (s) => s.twoAtLine },
  { id: 'sb-dq1',     th: 'จะมีมาสคอตถูกปรับแพ้อย่างน้อย 1 ตัวไหม?', resolve: (s) => s.dqCount >= 1 },
  { id: 'sb-crawl',   th: 'จะมีมาสคอตคลาน (ล้มแล้วเคลื่อนที่) ในช่วงสุดท้ายไหม?', resolve: (s) => s.crawlFinalStretch },
  { id: 'sb-empty',   th: 'ตอนที่ 1 เข้าเส้นชัย ช่วงสุดท้ายจะว่างไหม?', resolve: (s) => s.finalStretchEmptyAtWin },
  { id: 'sb-oob',     th: 'จะมีมาสคอตออกนอกสนามไหม? (หลุดท้าย/ตกขอบ/ตกค้างใต้เสื่อ)', resolve: (s) => s.outOfBounds >= 1 },
  { id: 'sb-share',   th: 'จะมีมาสคอต 2 ตัวหยุดอยู่ช่องเดียวกันพร้อมกันไหม?', resolve: (s) => s.sameSpace },
  { id: 'sb-ko',      th: 'จะมีมาสคอตโดนน็อกไหม? (ล้มซ้ำตอนที่ล้มอยู่แล้ว)', resolve: (s) => s.knockouts >= 1 },
];

const STARTING_MONEY = 10;   // ✅ คู่มือขั้นตอนจัดโต๊ะข้อ 5: "The Bookie gives everyone $10"
const TOTAL_RACES = 3;       // ✅ คู่มือ

module.exports = {
  MASCOTS, TRACK, STARTING_CARDS, RANDOM_POOL, MULTI_CARDS, ALL_MASCOT_CARDS,
  RANDOM_COUNT_BY_PLAYERS, HAND_SIZE, CARDS_TO_SUBMIT, TICKETS_PER_RACE,
  buildTicketStacks, SIDE_BETS, STARTING_MONEY, TOTAL_RACES, SIZES,
};
