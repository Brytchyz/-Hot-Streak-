/* ============================================================
   Hot Streak — shared render helpers (ใช้ทั้งฝั่งมือถือและจอบอร์ด)
   ============================================================ */
const M = {
  gobbler: { th: 'ก็อบเบลอร์', short: 'ก', color: 'var(--gobbler)', hex: '#E8712C' },
  hurley:  { th: 'เฮอร์ลีย์',  short: 'ฮ', color: 'var(--hurley)',  hex: '#E4635A' },
  dangle:  { th: 'แดงเกิล',    short: 'ด', color: 'var(--dangle)',  hex: '#4E7BD6' },
  mum:     { th: 'มัม',        short: 'ม', color: 'var(--mum)',     hex: '#B23A5E' },
};
const ORDER = ['gobbler', 'hurley', 'dangle', 'mum'];
const SIZE_TH = { top: 'ตั๋วบน', middle: 'ตั๋วกลาง', bottom: 'ตั๋วล่าง' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function cardLabel(c) {
  if (!c) return { who: '', act: '' };
  if (c.type === 'multi') {
    const bits = [];
    if (c.recover) bits.push('ลุกขึ้นหมด');
    if (c.amount > 0) bits.push(`เดิน ${c.amount}`);
    if (c.amount < 0) bits.push(`ถอย ${-c.amount}`);
    return { who: 'ทุกตัว', act: bits.join(' + '), hex: '#3E7A4E', multi: true };
  }
  const m = M[c.target];
  let act = '';
  switch (c.type) {
    case 'move':    act = c.amount >= 0 ? `เดิน ${c.amount}` : `ถอย ${-c.amount}`; break;
    case 'star':    act = '★ ไปดาวถัดไป'; break;
    case 'fall':    act = 'ล้ม!'; break;
    case 'turn':    act = 'หันหลังกลับ'; break;
    case 'swerve':  act = `เดิน ${c.amount} แล้วปัด${c.dir === 'R' ? 'ขวา' : 'ซ้าย'}`; break;
    case 'recover': act = `ลุกขึ้น แล้วเดิน ${c.amount}`; break;
  }
  return { who: m ? m.th : c.target, act, hex: m ? m.hex : '#999' };
}

function shortLabel(c) {
  if (c.type === 'multi') {
    const n = c.amount > 0 ? '+' + c.amount : c.amount < 0 ? String(c.amount) : '';
    return (c.recover ? 'ลุก' : '') + n;
  }
  switch (c.type) {
    case 'move':    return c.amount >= 0 ? '+' + c.amount : String(c.amount);
    case 'star':    return '★';
    case 'fall':    return 'ล้ม';
    case 'turn':    return 'กลับหลัง';
    case 'swerve':  return `${c.amount}${c.dir === 'R' ? '→' : '←'}`;
    case 'recover': return `ลุก+${c.amount}`;
  }
  return '?';
}
const isBad = (c) => ['fall', 'turn'].includes(c.type)
  || ((c.type === 'move' || c.type === 'multi') && c.amount < 0);

function feedLine(e) {
  const nm = (id) => M[id]?.th ?? id;
  switch (e.t) {
    case 'fall':      return { txt: `${nm(e.id)} ล้ม!`, cls: 'hot' };
    case 'collide':   return { txt: `${nm(e.by)} พุ่งชน ${nm(e.id)}`, cls: 'hot' };
    case 'turn':      return { txt: `${nm(e.id)} ${e.facing === -1 ? 'หันหลังกลับแล้ว!' : 'หันกลับมาถูกทางแล้ว'}`, cls: '' };
    case 'recover':   return { txt: `${nm(e.id)} ลุกขึ้นได้`, cls: '' };
    case 'swerve':    return { txt: `${nm(e.id)} ปัดเข้าเลน ${e.to + 1}`, cls: '' };
    case 'nostar':    return { txt: `${nm(e.id)} ไม่มีดาวให้ไป อยู่กับที่`, cls: '' };
    case 'finish':    return { txt: `🏁 ${nm(e.id)} เข้าเส้นชัย อันดับ ${e.place}`, cls: 'good' };
    case 'placed':    return { txt: `${nm(e.id)} ได้อันดับ ${e.place}`, cls: 'good' };
    case 'dq': {
      const why = { knockout: 'โดนน็อก', offSide: 'ตกขอบสนาม', offBack: 'หลุดท้ายสนาม', folded: 'ตกค้างตอนพับสนาม' }[e.reason];
      return { txt: `❌ ${nm(e.id)} ถูกปรับแพ้ — ${why} (อันดับ ${e.place})`, cls: 'hot' };
    }
    case 'fold':      return { txt: `สำรับหมด! สนามถูกพับสั้นลง`, cls: 'hot' };
    case 'reshuffle': return { txt: `สับไพ่ใหม่ เผาทิ้ง 3 ใบ แล้วไปต่อ`, cls: '' };
    default: return null;
  }
}

/* ---------------- ตั๋วเดิมพัน ---------------- */
function ticketEl(t, { mode = null, pickable = false, badge = null } = {}) {
  const isMascot = t.kind === 'mascot';
  const meta = isMascot ? M[t.mascot] : null;
  const name = isMascot ? meta.th : t.answer === 'YES' ? 'ใช่' : 'ไม่ใช่';
  const hex = isMascot ? meta.hex : t.answer === 'YES' ? '#3E7A4E' : '#8A5A2B';
  const m = mode || 'safe';
  const v = t.values[m];
  const labels = isMascot ? ['ที่ 1', 'ที่ 2', 'ที่ 3'] : ['ทายถูก', 'ทายผิด'];
  return `
    <div class="ticket ${m === 'risky' ? 'risky' : ''} ${pickable ? 'pickable' : ''}">
      ${badge ? `<span class="tk-badge">${badge}</span>` : ''}
      <span class="tk-flag" style="background:${hex}">${m === 'risky' ? 'RISKY' : 'SAFE'}</span>
      <span class="tk-body">
        <span class="tk-name">${name}</span>
        <span class="tk-size">${SIZE_TH[t.size]}</span>
      </span>
      <span class="tk-nums">
        ${v.map((n, i) => `<span class="tk-num"><b>${n < 0 ? '−$' + -n : '$' + n}</b><span>${labels[i]}</span></span>`).join('')}
      </span>
    </div>`;
}

function ticketBadge(t) {
  const isMascot = t.kind === 'mascot';
  const name = isMascot ? M[t.mascot].th : (t.answer === 'YES' ? 'ใช่' : 'ไม่ใช่');
  const hex = isMascot ? M[t.mascot].hex : (t.answer === 'YES' ? '#3E7A4E' : '#8A5A2B');
  return `<span class="tbadge ${t.mode === 'risky' ? 'risky' : ''}" style="--c:${hex}">${name} · ${SIZE_TH[t.size]}${t.mode === 'risky' ? ' · เสี่ยง' : ''}</span>`;
}

function deckGrid(deck) {
  if (!deck) return '';
  const by = { gobbler: [], hurley: [], dangle: [], mum: [], all: [] };
  deck.forEach((c) => (by[c.target] || by.all).push(c));
  const col = (k, title, hex) => `
    <div class="deckcol">
      <h3 style="color:${hex}">${title} <span style="color:var(--chalk-dim);font-weight:500">${by[k].length}</span></h3>
      <ul>${by[k].map((c) => `<li class="${isBad(c) ? 'bad' : ''}">${shortLabel(c)}</li>`).join('')}</ul>
    </div>`;
  return `<div class="deckgrid">
    ${ORDER.map((k) => col(k, M[k].th, M[k].hex)).join('')}
    ${by.all.length ? `<div style="grid-column:1/-1">${col('all', 'ไพ่เขียว (ทุกตัว)', '#6FBF7F')}</div>` : ''}
  </div>`;
}

/* ---------------- สนามแข่ง ---------------- */
function buildTrack(g) {
  const T = g.track;
  const lanes = ORDER.map((id, lane) => {
    const stars = (T.stars[lane] || []).filter((p) => p < T.length);
    let cells = '';
    for (let pos = T.length - 1; pos >= 0; pos--) {
      const cls = [
        stars.includes(pos) ? 'star' : '',
        T.sectionLines.includes(pos) ? 'line' : '',
        pos >= T.finalStretch ? 'stretch' : '',
      ].join(' ');
      cells += `<div class="cell ${cls}" data-lane="${lane}" data-pos="${pos}">${stars.includes(pos) ? '★' : ''}</div>`;
    }
    return `<div class="lane">${cells}</div>`;
  }).join('');
  const bandTop = ((T.length - T.finishAt) / T.length) * 100;
  return `
    <div class="trackwrap">
      <div class="trackarea">
        <div class="track">${lanes}</div>
        <div class="finishband" style="top:${bandTop}%"></div>
        <div class="chips">
        ${ORDER.map((id) => `
          <div class="chip" id="chip-${id}">
            <span class="dot" style="background:${M[id].hex}">${M[id].short}</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="lanetags">
        ${ORDER.map((id) => `<span style="color:${M[id].hex}">${M[id].th}</span>`).join('')}
      </div>
    </div>`;
}

function updateTrack(g) {
  const L = g.track.length;
  for (const m of g.mascots) {
    const el = document.getElementById('chip-' + m.id);
    if (!el) continue;
    el.style.left = m.lane * 25 + '%';
    el.style.top = ((L - 1 - Math.min(m.pos, L - 1)) * (100 / L)) + '%';
    el.classList.toggle('back', m.facing === -1);
    el.classList.toggle('fallen', m.fallen);
    el.classList.toggle('out', m.status !== 'racing');
  }
  document.querySelectorAll('.cell').forEach((c) => {
    c.classList.toggle('folded', +c.dataset.pos < g.backEdge);
  });
}

function podiumEl(g) {
  return `<div class="podium">${[0, 1, 2, 3].map((i) => {
    const id = g.podium?.[i];
    return `<div class="pod ${i === 0 ? 'p1' : ''}">
      <div class="pl">ที่ ${i + 1}</div>
      <div class="who" style="color:${id ? M[id].hex : 'var(--chalk-dim)'}">${id ? M[id].th : '—'}</div>
    </div>`;
  }).join('')}</div>`;
}
