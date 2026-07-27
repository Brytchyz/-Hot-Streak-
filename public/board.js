/* ============================================================
   Hot Streak — จอเจ้ามือ (คุมเกม แต่ไม่ใช่ผู้เล่น เหมือน Kahoot)
   ============================================================ */
const socket = io();
const $ = (s) => document.querySelector(s);
const app = $('#app');

let S = null;
let trackKey = null;

const roomCode = (new URLSearchParams(location.search).get('r') || '').toUpperCase().slice(0, 4);
const send = (ev, data) => socket.emit(ev, data || {});
const hostRoom = (code) => send('host', { code: (code || '').toUpperCase().trim() || null, origin: location.origin });

function homeForm(msg) {
  app.innerHTML = `
    <p class="eyebrow center">Hot Streak — จอเจ้ามือ</p>
    <h1 class="center">${msg || 'พร้อมเปิดโต๊ะแล้ว'}</h1>
    <div class="stack" style="max-width:320px;margin:20px auto 0">
      <button class="btn" id="mk">สร้างห้องใหม่</button>
      <p class="eyebrow center" style="margin:16px 0 4px">หรือกลับไปคุมห้องเดิม</p>
      <input id="cd" class="code" placeholder="รหัสห้อง" maxlength="4" autocomplete="off">
      <button class="btn ghost" id="rc">เข้าคุมห้องนี้</button>
    </div>`;
  $('#mk').onclick = () => hostRoom(null);
  $('#cd').oninput = (e) => { e.target.value = e.target.value.toUpperCase(); };
  $('#rc').onclick = () => hostRoom($('#cd').value);
}

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.hidden = true; }, 2600);
}

// ถ้ายังไม่เข้าห้อง (host/join ล้มเหลว) ค่อยเด้งกลับหน้าแรก — ถ้าเข้าห้องอยู่แล้ว
// error เล็ก ๆ (เช่น กดซ้ำ/action มาช้า) ไม่ควรล้างจอทั้งหน้าทิ้ง แค่เด้ง toast พอ
socket.on('err', (msg) => { if (S) toast(msg); else homeForm(msg); });
socket.on('joined', ({ code }) => {
  localStorage.setItem('hs_board_room', code);
  if (location.search) history.replaceState(null, '', location.pathname);
});
socket.on('state', (s) => { S = s; render(); });
socket.on('ended', () => {
  localStorage.removeItem('hs_board_room');
  S = null;
  homeForm('เกมจบแล้ว');
});
socket.on('connect', () => {
  const code = roomCode || localStorage.getItem('hs_board_room');
  if (code) hostRoom(code); else homeForm();
});

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  if (!S) return;
  const g = S.game;
  app.classList.toggle('wide', g && g.phase === 'betting');
  if (!g) return renderLobby();
  ({
    betting: renderBetting,
    submit: renderSubmit,
    racing: renderRacing,
    finished: renderFinished,
    payout: renderPayout,
    results: renderResults,
  }[g.phase] || renderLobby)();
}

function renderLobby() {
  const L = S.lobby;
  trackKey = null;
  app.innerHTML = `
    <p class="eyebrow center">ให้ทุกคนสแกนเข้าห้อง</p>
    ${L.qr
      ? `<div class="qrbox" style="max-width:280px">${L.qr}</div>
         <p class="qrurl">${esc(L.joinUrl || '')}</p>`
      : ''}
    <h1 class="center" style="font-size:56px;letter-spacing:.25em;margin-top:18px">${L.code}</h1>
    <p class="sub center">${L.players.length}/8 คน</p>
    <div class="plist" style="max-width:460px;margin:0 auto 18px">
      ${L.players.map((p) => `
        <div class="prow ${p.connected ? '' : 'off'}">
          <div class="prow-top">
            <span class="pn">${esc(p.name)}</span>
            ${p.connected ? '' : '<span class="tag">หลุด</span>'}
            <button class="tag" data-kick="${p.id}">เอาออก</button>
          </div>
        </div>`).join('')}
    </div>
    <div class="stack" style="max-width:320px;margin:0 auto">
      <button class="btn" id="go" ${L.players.length < 2 ? 'disabled' : ''}>
        ${L.players.length < 2 ? 'รออีกอย่างน้อย 1 คน' : `เริ่มเกม (${L.players.length} คน)`}
      </button>
    </div>`;
  $('#go').onclick = () => send('start');
  app.querySelectorAll('[data-kick]').forEach((b) => {
    b.onclick = () => send('kick', { playerId: b.dataset.kick });
  });
}

function renderBetting() {
  const g = S.game, d = g.draft;
  trackKey = null;
  const turnName = g.players.find((p) => p.id === d.currentPlayerId)?.name ?? '';

  const stackBlock = (k) => {
    const arr = g.stacks[k] || [];
    if (!arr.length) return `<div class="stack-empty">${k === 'YES' ? 'ใช่' : k === 'NO' ? 'ไม่ใช่' : M[k].th} — หมดแล้ว</div>`;
    return `<div>
      ${ticketEl(arr[0])}
      <div style="font-size:11px;color:var(--chalk-dim);margin:3px 0 0 12px">เหลือในกอง ${arr.length} ใบ</div>
    </div>`;
  };
  const mascotStacks = ORDER.map(stackBlock).join('');
  const sideStacks = ['YES', 'NO'].map(stackBlock).join('');

  const startMascots = ORDER.map((id, lane) => ({ id, lane, pos: g.track.start, facing: 1, fallen: false, status: 'racing' }));

  const centerDeck = `
    <p class="eyebrow center" style="margin:0 0 6px">สำรับที่ทุกคนเห็น</p>
    ${deckGrid(g.raceDeck)}`;

  app.innerHTML = `
    <p class="eyebrow center">ตาของ</p>
    <h1 class="center" style="margin-bottom:10px">${esc(turnName)}</h1>
    <div class="betting-grid">
      <div class="betting-table">
        ${seatTable(g.players, d.currentPlayerId, centerDeck)}
      </div>
      <div class="betting-track-col">
        <p class="eyebrow" style="margin:0 0 6px">สนามแข่ง</p>
        <div id="trk" class="betting-track">${buildTrack(g)}</div>
      </div>
      <div class="betting-col">
        <h2>เดิมพันตัวมาสคอต</h2>
        <div class="stackcol">${mascotStacks}</div>
      </div>
      <div class="betting-col">
        <div class="sidebet divider" style="margin-top:0">
          <p class="eyebrow" style="margin:0 0 4px">คำถามเดิมพันพิเศษของเรซนี้</p>
          <div class="q">${esc(g.sideBet.th)}</div>
        </div>
        <div class="stackcol">${sideStacks}</div>
      </div>
    </div>`;
  updateTrack({ track: g.track, mascots: startMascots });
}

function renderSubmit() {
  const g = S.game;
  trackKey = null;
  const doneCount = g.players.filter((p) => p.submitted).length;
  const startMascots = ORDER.map((id, lane) => ({ id, lane, pos: g.track.start, facing: 1, fallen: false, status: 'racing' }));

  app.innerHTML = `
    <p class="eyebrow">ก่อนออกสตาร์ท</p>
    <h1>ทุกคนกำลังแอบใส่ไพ่คนละ ${g.cardsToSubmit} ใบ</h1>
    <p class="sub">ส่งแล้ว ${doneCount}/${g.players.length} คน</p>

    <div id="trk" style="margin-bottom:22px">${buildTrack(g)}</div>

    <div class="plist" style="margin-bottom:22px">
      ${g.players.map((p) => `
        <div class="prow ${p.submitted ? '' : 'off'}">
          <div class="prow-top">
            <span class="pn">${esc(p.name)}</span>
            <span class="tag ${p.submitted ? 'ok' : ''}">${p.submitted ? 'ส่งแล้ว' : 'กำลังคิด…'}</span>
          </div>
          ${p.tickets.length ? `<div class="tbadges">${p.tickets.map((t) => ticketBadge(t, { showSize: false })).join('')}</div>` : ''}
        </div>`).join('')}
    </div>
    <h2>สำรับที่ทุกคนเห็น</h2>
    ${deckGrid(g.raceDeck)}`;
  updateTrack({ track: g.track, mascots: startMascots });
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
      <div class="stack" id="ctl" style="max-width:420px;margin:16px auto 0"></div>`;
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
  $('#ctl').innerHTML = `
    <div class="row">
      <button class="btn" id="fl" ${S.autoplay ? 'disabled' : ''}>เปิดไพ่ใบต่อไป</button>
      <button class="btn ghost" id="au" style="flex:0 0 42%">${S.autoplay ? 'หยุดอัตโนมัติ' : 'เล่นอัตโนมัติ'}</button>
    </div>`;
  $('#fl').onclick = () => send('flip');
  $('#au').onclick = () => send('auto', { on: !S.autoplay, speed: 1600 });
}

function renderFinished() {
  const g = S.game;
  trackKey = null;
  app.innerHTML = `
    <p class="eyebrow center">จบเรซ ${g.raceNo}</p>
    <h1 class="center">ผลการแข่งขัน</h1>
    ${podiumEl(g)}
    <div class="stack" style="max-width:320px;margin:22px auto 0">
      <button class="btn" id="rv">นับเงิน</button>
    </div>`;
  $('#rv').onclick = () => send('revealPayout');
}

function renderPayout() {
  const g = S.game;
  trackKey = null;
  const sum = g.summary;

  app.innerHTML = `
    <p class="eyebrow">จบเรซ ${g.raceNo}</p>
    <h1>นับเงิน</h1>
    ${podiumEl(g)}
    <div class="sidebet">
      <div class="q">${esc(g.sideBet.th)}</div>
      <div class="a">คำตอบ: ${g.sideAnswer === 'YES' ? 'ใช่' : 'ไม่ใช่'}</div>
    </div>

    <p class="eyebrow">สรุปสนาม</p>
    <div class="panel tight" style="margin-bottom:16px;font-size:13px;color:var(--chalk-dim)">
      ปรับแพ้ ${sum.dqCount} ตัว (ออกนอกสนาม ${sum.outOfBounds} · โดนน็อก ${sum.knockouts}) · ชนกัน ${sum.collisions} ครั้ง · สับไพ่ใหม่ ${sum.reshuffles} ครั้ง · เปิดไพ่ ${sum.cardsFlipped} ใบ
    </div>

    <h2>ผลตอบแทนแต่ละคน</h2>
    <div class="plist">
      ${[...g.payouts].sort((a, b) => b.total - a.total).map((pay) => {
        const p = g.players.find((x) => x.id === pay.playerId);
        return `<div class="prow">
          <div class="prow-top">
            <span class="pn">${esc(p?.name ?? '')}</span>
            <span class="pm" style="${pay.total < 0 ? 'color:var(--flag)' : ''}">${pay.total < 0 ? '−$' + -pay.total : '+$' + pay.total}</span>
          </div>
          <div class="tbadges">${pay.lines.map((l) => {
            const t = l.ticket;
            const nm = t.kind === 'mascot' ? M[t.mascot].th : (t.answer === 'YES' ? 'ใช่' : 'ไม่ใช่');
            const hex = t.kind === 'mascot' ? M[t.mascot].hex : (t.answer === 'YES' ? '#3E7A4E' : '#8A5A2B');
            return `<span class="tbadge" style="--c:${hex}">${nm} ${l.amount < 0 ? '−$' + -l.amount : '+$' + l.amount}</span>`;
          }).join('')}</div>
        </div>`;
      }).join('')}
    </div>

    <h2 style="margin-top:22px">ยอดเงินรวม</h2>
    <div class="plist" style="margin-bottom:22px">
      ${[...g.players].sort((a, b) => b.money - a.money).map((p, i) => `
        <div class="prow">
          <div class="prow-top">
            <span class="tag">${i + 1}</span>
            <span class="pn">${esc(p.name)}</span>
            <span class="pm">$${p.money}</span>
          </div>
        </div>`).join('')}
    </div>
    <div class="stack" style="max-width:320px;margin:0 auto">
      <button class="btn" id="nx">${g.raceNo >= g.totalRaces ? 'ดูผลรวมทั้งเกม' : `ไปเรซที่ ${g.raceNo + 1}`}</button>
    </div>`;
  $('#nx').onclick = () => send('next');
}

function renderResults() {
  const g = S.game;
  trackKey = null;
  const ranked = [...g.players].sort((a, b) => b.money - a.money);
  app.innerHTML = `
    <p class="eyebrow">จบ 3 เรซ</p>
    <h1>ผลสุดท้าย</h1>
    <div class="plist" style="margin-bottom:22px">
      ${ranked.map((p, i) => `
        <div class="prow">
          <div class="prow-top">
            <span class="tag ${i === 0 ? 'ok' : ''}">${i + 1}</span>
            <span class="pn">${esc(p.name)}</span>
            <span class="pm" style="font-size:22px">$${p.money}</span>
          </div>
        </div>`).join('')}
    </div>
    <div class="row" style="max-width:420px;margin:0 auto">
      <button class="btn" id="rm">เล่นอีกรอบ</button>
      <button class="btn ghost" id="end" style="flex:0 0 34%">จบเกม</button>
    </div>`;
  $('#rm').onclick = () => send('rematch');
  $('#end').onclick = () => send('end');
}

if (!roomCode) homeForm();
