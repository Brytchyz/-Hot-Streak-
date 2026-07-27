/* ============================================================
   Hot Streak — จอบอร์ด (ดูอย่างเดียว ไม่มี identity ของตัวเอง)
   ============================================================ */
const socket = io();
const $ = (s) => document.querySelector(s);
const app = $('#app');

let S = null;
let trackKey = null;

const roomCode = (new URLSearchParams(location.search).get('r') || '').toUpperCase().slice(0, 4);
const watch = (code) => socket.emit('watch', { code: (code || '').toUpperCase().trim() });

function codeForm(msg) {
  app.innerHTML = `
    <p class="eyebrow center">Hot Streak — จอบอร์ด</p>
    <h1 class="center">${msg || 'ใส่รหัสห้อง'}</h1>
    <div class="stack" style="max-width:300px;margin:20px auto 0">
      <input id="cd" class="code" placeholder="รหัส" maxlength="4" autocomplete="off">
      <button class="btn" id="wt">เปิดจอบอร์ด</button>
    </div>`;
  $('#cd').oninput = (e) => { e.target.value = e.target.value.toUpperCase(); };
  $('#wt').onclick = () => watch($('#cd').value);
}

socket.on('err', (msg) => codeForm(msg));
socket.on('state', (s) => { S = s; render(); });
socket.on('connect', () => { if (roomCode) watch(roomCode); else codeForm(); });

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  if (!S) return;
  const g = S.game;
  if (!g) return renderLobby();
  ({
    betting: renderBetting,
    submit: renderSubmit,
    racing: renderRacing,
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
    <div class="plist" style="max-width:460px;margin:0 auto">
      ${L.players.map((p) => `
        <div class="prow ${p.connected ? '' : 'off'}">
          <div class="prow-top">
            <span class="pn">${esc(p.name)}</span>
            ${p.id === L.hostId ? '<span class="tag ok">เจ้ามือ</span>' : ''}
            ${p.connected ? '' : '<span class="tag">หลุด</span>'}
          </div>
        </div>`).join('')}
    </div>`;
}

function renderBetting() {
  const g = S.game, d = g.draft;
  trackKey = null;
  const turnName = g.players.find((p) => p.id === d.currentPlayerId)?.name ?? '';

  const stacks = ORDER.concat(['YES', 'NO']).map((k) => {
    const arr = g.stacks[k] || [];
    if (!arr.length) return `<div class="stack-empty">${k === 'YES' ? 'ใช่' : k === 'NO' ? 'ไม่ใช่' : M[k].th} — หมดแล้ว</div>`;
    return `<div>
      ${ticketEl(arr[0])}
      <div style="font-size:11px;color:var(--chalk-dim);margin:3px 0 0 12px">เหลือในกอง ${arr.length} ใบ</div>
    </div>`;
  }).join('');

  app.innerHTML = `
    <div class="sidebet">
      <p class="eyebrow" style="margin:0 0 4px">คำถามเดิมพันพิเศษของเรซนี้</p>
      <div class="q">${esc(g.sideBet.th)}</div>
    </div>
    <h2>กำลังรอ ${esc(turnName)} เลือกตั๋ว</h2>
    <div class="stackcol">${stacks}</div>

    <h2 style="margin-top:22px">ผู้เล่น</h2>
    <div class="plist">
      ${g.players.map((p) => `
        <div class="prow ${p.id === d.currentPlayerId ? 'turn' : ''}">
          <div class="prow-top">
            <span class="pn">${esc(p.name)}</span>
            <span class="tag">${p.tickets.length} ใบ</span>
            <span class="pm">$${p.money}</span>
          </div>
          ${p.tickets.length ? `<div class="tbadges">${p.tickets.map(ticketBadge).join('')}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function renderSubmit() {
  const g = S.game;
  trackKey = null;
  const doneCount = g.players.filter((p) => p.submitted).length;
  app.innerHTML = `
    <p class="eyebrow">ก่อนออกสตาร์ท</p>
    <h1>ทุกคนกำลังแอบใส่ไพ่คนละ ${g.cardsToSubmit} ใบ</h1>
    <p class="sub">ส่งแล้ว ${doneCount}/${g.players.length} คน</p>
    <div class="plist" style="margin-bottom:22px">
      ${g.players.map((p) => `
        <div class="prow ${p.submitted ? '' : 'off'}">
          <div class="prow-top">
            <span class="pn">${esc(p.name)}</span>
            <span class="tag ${p.submitted ? 'ok' : ''}">${p.submitted ? 'ส่งแล้ว' : 'กำลังคิด…'}</span>
          </div>
        </div>`).join('')}
    </div>
    <h2>สำรับที่ทุกคนเห็น</h2>
    ${deckGrid(g.raceDeck)}`;
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
      <div class="feed" id="fd"></div>`;
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
    <div class="plist">
      ${[...g.players].sort((a, b) => b.money - a.money).map((p, i) => `
        <div class="prow">
          <div class="prow-top">
            <span class="tag">${i + 1}</span>
            <span class="pn">${esc(p.name)}</span>
            <span class="pm">$${p.money}</span>
          </div>
        </div>`).join('')}
    </div>`;
}

function renderResults() {
  const g = S.game;
  trackKey = null;
  const ranked = [...g.players].sort((a, b) => b.money - a.money);
  app.innerHTML = `
    <p class="eyebrow">จบ 3 เรซ</p>
    <h1>ผลสุดท้าย</h1>
    <div class="plist">
      ${ranked.map((p, i) => `
        <div class="prow">
          <div class="prow-top">
            <span class="tag ${i === 0 ? 'ok' : ''}">${i + 1}</span>
            <span class="pn">${esc(p.name)}</span>
            <span class="pm" style="font-size:22px">$${p.money}</span>
          </div>
        </div>`).join('')}
    </div>`;
}

if (!roomCode) codeForm();
