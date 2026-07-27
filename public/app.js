/* ============================================================
   Hot Streak — client
   ============================================================ */
const socket = io();
const $ = (s) => document.querySelector(s);
const app = $('#app'), bar = $('#bar');

const M = {
  gobbler: { th: 'ก็อบเบลอร์', short: 'ก', color: 'var(--gobbler)', hex: '#E8712C' },
  hurley:  { th: 'เฮอร์ลีย์',  short: 'ฮ', color: 'var(--hurley)',  hex: '#E4635A' },
  dangle:  { th: 'แดงเกิล',    short: 'ด', color: 'var(--dangle)',  hex: '#4E7BD6' },
  mum:     { th: 'มัม',        short: 'ม', color: 'var(--mum)',     hex: '#B23A5E' },
};
const ORDER = ['gobbler', 'hurley', 'dangle', 'mum'];
const SIZE_TH = { top: 'ตั๋วบน', middle: 'ตั๋วกลาง', bottom: 'ตั๋วล่าง' };

let S = null;              // state จากเซิร์ฟเวอร์
let sel = new Set();       // ไพ่ที่เลือกจะใส่
let trackKey = null;       // ใช้เช็คว่าต้องสร้างสนามใหม่ไหม

const pid = (() => {
  let v = localStorage.getItem('hs_pid');
  if (!v) { v = 'u' + Math.random().toString(36).slice(2, 10); localStorage.setItem('hs_pid', v); }
  return v;
})();
const savedName = () => localStorage.getItem('hs_name') || '';

/* ---------------- helpers ---------------- */
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

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.hidden = true; }, 2600);
}

const send = (ev, data) => socket.emit(ev, data || {});
const ORIGIN = location.origin;
const inviteCode = (new URLSearchParams(location.search).get('r') || '').toUpperCase().slice(0, 4);

/* ---------------- socket ---------------- */
socket.on('err', toast);
socket.on('joined', ({ code }) => {
  localStorage.setItem('hs_room', code);
  // ล้าง ?r= ออกจาก URL จะได้ไม่ค้างตอนรีเฟรช
  if (location.search) history.replaceState(null, '', location.pathname);
});
socket.on('state', (s) => { S = s; render(); });
socket.on('connect', () => {
  const room = inviteCode || localStorage.getItem('hs_room');
  if (room && savedName()) send('join', { code: room, name: savedName(), playerId: pid, origin: ORIGIN });
});

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  if (!S) return renderHome();
  const pend = S.game?.draft?.pending;
  if (!pend || pend.playerId !== S.yourId) document.querySelector('.sheet-choose')?.remove();
  const g = S.game;
  bar.hidden = !g;
  if (g) {
    $('#barRace').innerHTML = `เรซ ${g.raceNo}<i>/${g.totalRaces}</i>`;
    $('#barRoom').textContent = S.lobby.code;
    $('#barMoney').textContent = '$' + (S.you?.money ?? 0);
  }
  if (!g) return renderLobby();
  ({
    betting: renderBetting,
    submit: renderSubmit,
    racing: renderRacing,
    payout: renderPayout,
    results: renderResults,
  }[g.phase] || renderLobby)();
}

/* ---------------- หน้าแรก ---------------- */
function renderHome() {
  bar.hidden = true;
  trackKey = null;
  const invited = !!inviteCode;

  app.innerHTML = `
    <p class="eyebrow">แข่งมาสคอต · แทงพนัน · ตะโกน</p>
    <h1>Hot Streak</h1>
    ${invited
      ? `<p class="sub">คุณกำลังจะเข้าห้อง <b style="color:var(--amber);letter-spacing:.15em">${inviteCode}</b> — ใส่ชื่อแล้วกดเข้าเลย</p>
         <div class="stack">
           <input id="nm" placeholder="ชื่อของคุณ" maxlength="14" value="${esc(savedName())}">
           <button class="btn" id="jn">เข้าห้อง ${inviteCode}</button>
           <button class="btn ghost sm" id="other">เข้าห้องอื่นแทน</button>
         </div>`
      : `<p class="sub">เปิดในมือถือทุกคน ไพ่ในมือใครในมือมัน สนามแข่งเห็นพร้อมกัน</p>
         <div class="stack">
           <input id="nm" placeholder="ชื่อของคุณ" maxlength="14" value="${esc(savedName())}">
           <button class="btn" id="mk">สร้างห้องใหม่</button>
           <p class="eyebrow center" style="margin:8px 0 0">หรือเข้าห้องที่มีอยู่</p>
           <input id="cd" class="code" placeholder="รหัส" maxlength="4" autocomplete="off">
           <button class="btn ghost" id="jn">เข้าห้อง</button>
         </div>`}`;

  const name = () => { const v = $('#nm').value.trim(); if (v) localStorage.setItem('hs_name', v); return v; };
  if ($('#mk')) $('#mk').onclick = () => send('create', { name: name(), playerId: pid, origin: ORIGIN });
  $('#jn').onclick = () => send('join', {
    code: invited ? inviteCode : $('#cd').value, name: name(), playerId: pid, origin: ORIGIN,
  });
  if ($('#cd')) $('#cd').oninput = (e) => { e.target.value = e.target.value.toUpperCase(); };
  if ($('#other')) $('#other').onclick = () => { history.replaceState(null, '', location.pathname); location.reload(); };
  if (invited && savedName()) $('#jn').focus();
}

/* ---------------- ล็อบบี้ ---------------- */
function renderLobby() {
  const L = S.lobby;
  trackKey = null;
  app.innerHTML = `
    <p class="eyebrow">ให้เพื่อนสแกนอันนี้</p>
    ${L.qr
      ? `<div class="qrbox">${L.qr}</div>
         <p class="qrurl">${esc(L.joinUrl || '')}</p>`
      : ''}
    <p class="eyebrow center" style="margin-top:14px">หรือใส่รหัสห้องเอง</p>
    <h1 class="center" style="font-size:40px;letter-spacing:.2em;margin-bottom:14px">${L.code}</h1>
    <p class="sub center">${L.players.length}/8 คน</p>
    <div class="plist">
      ${L.players.map((p) => `
        <div class="prow ${p.connected ? '' : 'off'}">
          <span class="pn">${esc(p.name)}</span>
          ${p.id === L.hostId ? '<span class="tag ok">เจ้ามือ</span>' : ''}
          ${p.connected ? '' : '<span class="tag">หลุด</span>'}
          ${S.isHost && p.id !== L.hostId ? `<button class="tag" data-kick="${p.id}">เอาออก</button>` : ''}
        </div>`).join('')}
    </div>
    <div class="dock"><div class="dock-inner">
      ${S.isHost
        ? `<button class="btn" id="go" ${L.players.length < 2 ? 'disabled' : ''}>
             ${L.players.length < 2 ? 'รออีกอย่างน้อย 1 คน' : `เริ่มเกม (${L.players.length} คน)`}
           </button>`
        : `<p class="center muted" style="margin:0">รอเจ้ามือกดเริ่มเกม</p>`}
    </div></div>`;
  if ($('#go')) $('#go').onclick = () => send('start');
  app.querySelectorAll('[data-kick]').forEach((b) => {
    b.onclick = () => send('kick', { playerId: b.dataset.kick });
  });
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

function renderBetting() {
  const g = S.game, d = g.draft;
  const myTurn = d.currentPlayerId === S.yourId;
  const turnName = g.players.find((p) => p.id === d.currentPlayerId)?.name ?? '';

  const stacks = ORDER.concat(['YES', 'NO']).map((k) => {
    const arr = g.stacks[k] || [];
    if (!arr.length) return `<div class="stack-empty">${k === 'YES' ? 'ใช่' : k === 'NO' ? 'ไม่ใช่' : M[k].th} — หมดแล้ว</div>`;
    return `<button style="all:unset;display:block" data-stack="${k}">
      ${ticketEl(arr[0], { pickable: myTurn })}
      ${arr.length > 1 ? `<div style="font-size:11px;color:var(--chalk-dim);margin:3px 0 0 12px">เหลืออีก ${arr.length - 1} ใบในกอง</div>` : ''}
    </button>`;
  }).join('');

  app.innerHTML = `
    <div class="sidebet">
      <p class="eyebrow" style="margin:0 0 4px">คำถามเดิมพันพิเศษของเรซนี้</p>
      <div class="q">${esc(g.sideBet.th)}</div>
    </div>
    <button class="btn ghost sm" id="peek" style="margin-bottom:16px">ดูสำรับ / ไพ่ในมือ ก่อนแทง</button>
    <p class="eyebrow">${myTurn ? 'ตาคุณเลือกตั๋ว' : 'กำลังรอ ' + esc(turnName)}</p>
    <h2>${myTurn ? 'หยิบตั๋ว 1 ใบจากกองไหนก็ได้' : 'สนามพนัน'}</h2>
    <div class="stackcol">${stacks}</div>

    <h2 style="margin-top:22px">ตั๋วในมือคุณ</h2>
    ${(S.you.tickets || []).length
      ? `<div class="stackcol">${S.you.tickets.map((t) => ticketEl(t, { mode: t.mode })).join('')}</div>`
      : '<p class="muted" style="margin:0">ยังไม่มี</p>'}

    <h2 style="margin-top:22px">ลำดับการเลือก</h2>
    <div class="plist">
      ${g.players.map((p) => `
        <div class="prow ${p.id === d.currentPlayerId ? 'turn' : ''}">
          <span class="pn">${esc(p.name)}${p.id === S.yourId ? ' (คุณ)' : ''}</span>
          <span class="tag">${p.tickets.length} ใบ</span>
          <span class="pm">$${p.money}</span>
        </div>`).join('')}
    </div>`;

  if ($('#peek')) $('#peek').onclick = () => sheetPeek('deck');
  if (myTurn && !d.pending) {
    app.querySelectorAll('[data-stack]').forEach((b) => {
      b.onclick = () => send('draft', { stack: b.dataset.stack });
    });
  }
  if (d.pending && d.pending.playerId === S.yourId && !document.querySelector('.sheet-choose')) {
    sheetChooseSide(d.pending.ticket);
  }
}

function sheetChooseSide(t) {
  document.querySelector('.sheet-peek')?.remove();
  const el = document.createElement('div');
  el.className = 'sheet sheet-choose';
  el.innerHTML = `
    <div class="sheet-in">
      <p class="eyebrow">คุณหยิบตั๋วใบนี้</p>
      <h2>เลือกด้าน ปลอดภัย หรือ เสี่ยง</h2>
      <div class="stackcol" style="margin-bottom:16px">
        <button style="all:unset;display:block" data-m="safe">${ticketEl(t, { mode: 'safe' })}</button>
        <button style="all:unset;display:block" data-m="risky">${ticketEl(t, { mode: 'risky' })}</button>
      </div>
      <p class="muted center" style="margin:0;font-size:13px">
        ${t.kind === 'mascot' ? 'ด้านเสี่ยงจ่ายหนักถ้าเข้าที่ 1 แต่ที่ 2–3 ได้น้อยลง' : 'ด้านเสี่ยงจ่ายหนักถ้าทายถูก แต่ทายผิดเสียเงิน'}
      </p>
    </div>`;
  document.body.appendChild(el);
  el.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = () => { send('side', { mode: b.dataset.m }); el.remove(); };
  });
}

/* ---------------- แอบดูสำรับ/ไพ่ในมือ ก่อนแทง ---------------- */
function handPeek(hand) {
  if (!hand || !hand.length) return '<p class="muted center" style="margin:0">ไม่มีไพ่ในมือ</p>';
  return `<div class="hand">
    ${hand.map((c) => {
      const L = cardLabel(c);
      return `<div class="handcard" style="border-left-color:${L.hex}">
        <span class="hc-act">${L.act}</span>
        <span class="hc-who">${L.who}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function sheetPeek(tab = 'deck') {
  document.querySelector('.sheet-peek')?.remove();
  const el = document.createElement('div');
  el.className = 'sheet sheet-peek';
  el.onclick = (e) => { if (e.target === el) el.remove(); };
  const draw = () => {
    el.innerHTML = `
      <div class="sheet-in">
        <div class="row" style="margin-bottom:14px">
          <button class="btn ${tab === 'deck' ? '' : 'ghost'} sm" data-tab="deck">สำรับที่ทุกคนเห็น</button>
          <button class="btn ${tab === 'hand' ? '' : 'ghost'} sm" data-tab="hand">ไพ่ในมือคุณ</button>
        </div>
        <div style="max-height:58vh;overflow-y:auto">
          ${tab === 'deck' ? deckGrid(S.game.raceDeck) : handPeek(S.you.hand)}
        </div>
        <button class="btn ghost sm" id="peekClose" style="margin-top:14px">ปิด</button>
      </div>`;
    el.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => { tab = b.dataset.tab; draw(); };
    });
    el.querySelector('#peekClose').onclick = () => el.remove();
  };
  draw();
  document.body.appendChild(el);
}

/* ---------------- แอบใส่ไพ่ ---------------- */
function renderSubmit() {
  const g = S.game;
  const need = g.cardsToSubmit;
  const done = !!g.players.find((p) => p.id === S.yourId)?.submitted;
  const needDouble = g.raceNo === 3 && !S.you.doubledTicket;

  app.innerHTML = `
    <p class="eyebrow">ก่อนออกสตาร์ท</p>
    <h1>แอบใส่ไพ่ ${need} ใบ</h1>
    <p class="sub">โอกาสเดียวที่คุณจะแทรกแซงการแข่ง ห้ามให้ใครเห็น — แต่จะโม้ จะหลอก จะจับมือกันก็ตามสบาย</p>

    ${needDouble ? `
      <div class="sidebet" style="border-color:var(--amber)">
        <p class="eyebrow" style="margin:0 0 6px">เรซสุดท้าย</p>
        <div class="q" style="margin-bottom:10px">เลือก 1 ตั๋วให้จ่ายเป็นสองเท่า (ติดลบก็คูณสองนะ)</div>
        <div class="stackcol">
          ${S.you.tickets.map((t) => `<button style="all:unset;display:block" data-dbl="${t.id}">${ticketEl(t, { mode: t.mode })}</button>`).join('')}
        </div>
      </div>` : ''}

    ${done ? '<div class="panel center" style="margin-bottom:14px">ส่งไพ่แล้ว รอคนอื่น…</div>' : `
      <div class="hand">
        ${S.you.hand.map((c) => {
          const L = cardLabel(c);
          return `<button class="handcard ${sel.has(c.uid) ? 'sel' : ''}" data-uid="${c.uid}" style="border-left-color:${L.hex}">
            <span class="hc-act">${L.act}</span>
            <span class="hc-who">${L.who}</span>
          </button>`;
        }).join('')}
      </div>`}

    <h2 style="margin-top:22px">สำรับที่ทุกคนเห็น</h2>
    ${deckGrid(g.raceDeck)}

    <div class="dock"><div class="dock-inner">
      ${done
        ? `<p class="center muted" style="margin:0">รออีก ${g.players.filter((p) => !p.submitted).length} คน</p>`
        : `<button class="btn" id="sb" ${sel.size !== need || needDouble ? 'disabled' : ''}>
             ${needDouble ? 'เลือกตั๋วคูณสองก่อน' : `ใส่ไพ่ ${sel.size}/${need}`}
           </button>`}
    </div></div>`;

  app.querySelectorAll('[data-uid]').forEach((b) => {
    b.onclick = () => {
      const u = b.dataset.uid;
      if (sel.has(u)) sel.delete(u);
      else { if (sel.size >= need) sel.delete([...sel][0]); sel.add(u); }
      renderSubmit();
    };
  });
  app.querySelectorAll('[data-dbl]').forEach((b) => {
    b.onclick = () => send('double', { ticketId: b.dataset.dbl });
  });
  if ($('#sb')) $('#sb').onclick = () => { send('submit', { uids: [...sel] }); sel.clear(); };
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
      cells += `<div class="cell ${cls}" data-lane="${lane}" data-pos="${pos}">${stars.includes(pos) ? '\u2605' : ''}</div>`;
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

function renderRacing() {
  const g = S.game;
  const key = 'r' + g.raceNo;
  const L = cardLabel(g.lastCard);

  if (trackKey !== key) {
    trackKey = key;
    app.innerHTML = `
      <div id="pod"></div>
      <div id="trk">${buildTrack(g)}</div>
      <div class="deckline"><span id="dl"></span><span id="df"></span></div>
      <div id="fc"></div>
      <div class="feed" id="fd"></div>
      <div class="dock"><div class="dock-inner" id="dk"></div></div>`;
  }
  $('#pod').innerHTML = podiumEl(g);
  updateTrack(g);
  $('#dl').textContent = `เหลือในสำรับ ${g.deckLeft} ใบ`;
  $('#df').textContent = `เปิดไปแล้ว ${g.cardsFlipped} ใบ`;
  $('#fc').innerHTML = g.lastCard
    ? `<div class="flipcard" style="border-left-color:${L.hex}" data-k="${g.cardsFlipped}">
         <span class="fc-who" style="color:${L.hex}">${L.who}</span>
         <span class="fc-act">${L.act}</span>
       </div>`
    : `<div class="flipcard empty">3… 2… 1… เผาไพ่ 3 ใบแล้ว พร้อมออกตัว</div>`;
  $('#fd').innerHTML = (g.feed || []).map(feedLine).filter(Boolean)
    .map((l) => `<div class="${l.cls}">${l.txt}</div>`).join('');
  $('#dk').innerHTML = S.isHost
    ? `<div class="row">
         <button class="btn" id="fl" ${S.autoplay ? 'disabled' : ''}>เปิดไพ่ใบต่อไป</button>
         <button class="btn ghost" id="au" style="flex:0 0 42%">${S.autoplay ? 'หยุดอัตโนมัติ' : 'เล่นอัตโนมัติ'}</button>
       </div>`
    : `<p class="center muted" style="margin:0">เจ้ามือกำลังเปิดไพ่ · ตะโกนได้ตามสบาย</p>`;
  if ($('#fl')) $('#fl').onclick = () => send('flip');
  if ($('#au')) $('#au').onclick = () => send('auto', { on: !S.autoplay, speed: 1600 });
}

/* ---------------- จ่ายเงิน ---------------- */
function renderPayout() {
  const g = S.game;
  trackKey = null;
  const mine = g.payouts.find((p) => p.playerId === S.yourId);
  const sum = g.summary;

  app.innerHTML = `
    <p class="eyebrow">จบเรซ ${g.raceNo}</p>
    <h1>นับเงิน</h1>
    ${podiumEl(g)}
    <div class="sidebet">
      <div class="q">${esc(g.sideBet.th)}</div>
      <div class="a">คำตอบ: ${g.sideAnswer === 'YES' ? 'ใช่' : 'ไม่ใช่'}</div>
    </div>

    <div class="panel" style="margin-bottom:16px">
      ${mine.lines.map((l) => {
        const t = l.ticket;
        const nm = t.kind === 'mascot' ? M[t.mascot].th : (t.answer === 'YES' ? 'ใช่' : 'ไม่ใช่');
        const cls = l.amount > 0 ? 'plus' : l.amount < 0 ? 'minus' : 'zero';
        return `<div class="pay">
          <span class="py-t">
            <span class="py-n">${nm} · ${SIZE_TH[t.size]} · ${t.mode === 'risky' ? 'เสี่ยง' : 'ปลอดภัย'}${l.doubled ? ' · ×2' : ''}</span>
            <span class="py-s">${l.note}</span>
          </span>
          <span class="py-v ${cls}">${l.amount < 0 ? '−$' + -l.amount : '+$' + l.amount}</span>
        </div>`;
      }).join('')}
      <div class="total"><span>รวมเรซนี้</span><b>${mine.total < 0 ? '−$' + -mine.total : '+$' + mine.total}</b></div>
    </div>

    <p class="eyebrow">สรุปสนาม</p>
    <div class="panel tight" style="margin-bottom:16px;font-size:13px;color:var(--chalk-dim)">
      ปรับแพ้ ${sum.dqCount} ตัว (ออกนอกสนาม ${sum.outOfBounds} · โดนน็อก ${sum.knockouts}) · ชนกัน ${sum.collisions} ครั้ง · สับไพ่ใหม่ ${sum.reshuffles} ครั้ง · เปิดไพ่ ${sum.cardsFlipped} ใบ
    </div>

    <h2>ตารางเงิน</h2>
    <div class="plist">
      ${[...g.players].sort((a, b) => b.money - a.money).map((p, i) => `
        <div class="prow ${p.id === S.yourId ? 'turn' : ''}">
          <span class="tag">${i + 1}</span>
          <span class="pn">${esc(p.name)}</span>
          <span class="pm">$${p.money}</span>
        </div>`).join('')}
    </div>

    <div class="dock"><div class="dock-inner">
      ${S.isHost
        ? `<button class="btn" id="nx">${g.raceNo >= g.totalRaces ? 'ดูผลรวมทั้งเกม' : `ไปเรซที่ ${g.raceNo + 1}`}</button>`
        : '<p class="center muted" style="margin:0">รอเจ้ามือไปต่อ</p>'}
    </div></div>`;
  if ($('#nx')) $('#nx').onclick = () => send('next');
}

/* ---------------- ผลรวม ---------------- */
function renderResults() {
  const g = S.game;
  trackKey = null;
  const ranked = [...g.players].sort((a, b) => b.money - a.money);
  app.innerHTML = `
    <p class="eyebrow">จบ 3 เรซ</p>
    <h1>ชีวิตคุณลงเอยยังไง</h1>
    <p class="sub">เปิดหน้าตาราง life outcomes ในคู่มือ แล้วอ่านตามยอดเงินของแต่ละคน</p>
    <div class="plist">
      ${ranked.map((p, i) => `
        <div class="prow ${p.id === S.yourId ? 'turn' : ''}">
          <span class="tag ${i === 0 ? 'ok' : ''}">${i + 1}</span>
          <span class="pn">${esc(p.name)}</span>
          <span class="pm" style="font-size:22px">$${p.money}</span>
        </div>`).join('')}
    </div>
    <div class="dock"><div class="dock-inner">
      ${S.isHost ? '<button class="btn" id="rm">เล่นอีกรอบ</button>' : '<p class="center muted" style="margin:0">รอเจ้ามือเริ่มรอบใหม่</p>'}
    </div></div>`;
  if ($('#rm')) $('#rm').onclick = () => send('rematch');
}

renderHome();
