const D = require('./data');

// ---------- utilities ----------
function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let cardSeq = 0;
const stampCard = (card) => ({ ...card, uid: `c${++cardSeq}` });

// ============================================================
// Game
// ============================================================
class Game {
  constructor(players, rng = Math.random) {
    this.rng = rng;
    this.players = players.map((p) => ({
      id: p.id,
      name: p.name,
      money: D.STARTING_MONEY,
      hand: [],
      tickets: [],
      submitted: null,
      doubledTicket: null,
      log: [],
    }));
    this.raceNo = 0;
    this.phase = 'lobby'; // lobby | betting | submit | racing | payout | results
    this.sideBetDeck = shuffle(D.SIDE_BETS, rng);
    this.sideBetIndex = 0;
    this.firstDrafter = 0;
    this.events = [];
    this.raceLog = [];
  }

  get n() { return this.players.length; }
  get ticketsPerRace() { return D.TICKETS_PER_RACE; }
  get handSize() { return D.HAND_SIZE; }
  get currentSideBet() { return this.sideBetDeck[this.sideBetIndex % this.sideBetDeck.length]; }
  player(id) { return this.players.find((p) => p.id === id); }

  // ---------- เริ่มเกม ----------
  start() {
    const randomCount = D.RANDOM_COUNT_BY_PLAYERS[this.n];
    if (!randomCount) throw new Error('รองรับ 2-8 คนเท่านั้น');

    const pool = shuffle(D.RANDOM_POOL, this.rng).map(stampCard);
    this.raceDeck = [...D.STARTING_CARDS.map(stampCard), ...pool.slice(0, randomCount)];

    // มือเริ่มต้นแจกจากไพ่ที่ "ไม่ได้ใช้" ตามคู่มือ
    let rest = pool.slice(randomCount);
    for (const p of this.players) {
      p.hand = rest.splice(0, this.handSize);
    }
    this.beginBetting();
  }

  // ---------- เฟสเดิมพัน (snake draft) ----------
  beginBetting() {
    this.raceNo += 1;
    this.phase = 'betting';
    this.stacks = D.buildTicketStacks();
    this.players.forEach((p) => { p.tickets = []; p.doubledTicket = null; p.submitted = null; });

    const n = this.n;
    const order = [];
    for (let round = 0; round < this.ticketsPerRace; round++) {
      const seq = [...Array(n).keys()].map((i) => (this.firstDrafter + i) % n);
      order.push(...(round % 2 === 0 ? seq : [...seq].reverse()));
    }
    this.draftOrder = order;
    this.draftIndex = 0;
    this.pendingTicket = null; // ตั๋วที่เพิ่งหยิบ รอเลือก safe/risky
  }

  get currentDrafter() {
    if (this.phase !== 'betting') return null;
    return this.players[this.draftOrder[this.draftIndex]] ?? null;
  }

  draftTicket(playerId, stackKey) {
    if (this.phase !== 'betting') throw new Error('ยังไม่ถึงเฟสเดิมพัน');
    if (this.pendingTicket) throw new Error('เลือก ปลอดภัย/เสี่ยง ของตั๋วก่อนหน้าก่อน');
    const cur = this.currentDrafter;
    if (!cur || cur.id !== playerId) throw new Error('ยังไม่ถึงตาคุณ');
    const stack = this.stacks[stackKey];
    if (!stack || !stack.length) throw new Error('กองนี้หมดแล้ว');
    this.pendingTicket = { playerId, ticket: stack.shift() };
    return this.pendingTicket;
  }

  chooseSide(playerId, mode) {
    if (!this.pendingTicket || this.pendingTicket.playerId !== playerId) throw new Error('ไม่มีตั๋วรอเลือก');
    if (!['safe', 'risky'].includes(mode)) throw new Error('ต้องเป็น safe หรือ risky');
    const p = this.player(playerId);
    p.tickets.push({ ...this.pendingTicket.ticket, mode });
    this.pendingTicket = null;
    this.draftIndex += 1;
    if (this.draftIndex >= this.draftOrder.length) this.beginSubmit();
  }

  // ---------- เฟสแอบใส่ไพ่ ----------
  beginSubmit() {
    this.phase = 'submit';
    this.cardsToSubmit = D.CARDS_TO_SUBMIT;
    this.players.forEach((p) => { p.submitted = null; });
  }

  submitCards(playerId, uids) {
    if (this.phase !== 'submit') throw new Error('ยังไม่ถึงเฟสใส่ไพ่');
    const p = this.player(playerId);
    if (p.submitted) throw new Error('ส่งไพ่ไปแล้ว');
    if (uids.length !== this.cardsToSubmit) throw new Error(`ต้องเลือก ${this.cardsToSubmit} ใบ`);
    const chosen = uids.map((u) => {
      const idx = p.hand.findIndex((c) => c.uid === u);
      if (idx < 0) throw new Error('ไม่มีไพ่ใบนี้ในมือ');
      return p.hand.splice(idx, 1)[0];
    });
    p.submitted = chosen;
    if (this.players.every((x) => x.submitted)) this.beginRace();
  }

  // ---------- เฟสแข่ง ----------
  beginRace() {
    this.phase = 'racing';
    const injected = this.players.flatMap((p) => p.submitted);
    this.fullDeck = shuffle([...this.raceDeck, ...injected], this.rng);
    this.deck = [...this.fullDeck];
    this.burned = [];
    this.discard = [];
    this.cardsFlipped = 0;
    this.foldStep = 0;
    this.backEdge = 0;
    this.raceLog = [];
    this.raceFeed = [];

    this.mascots = D.MASCOTS.map((m) => ({
      id: m.id, lane: m.lane, pos: D.TRACK.start,
      fallen: false, facing: 1, status: 'racing', place: null,
    }));
    this.podium = [null, null, null, null]; // index 0 = ที่ 1

    this.summary = {
      // สถิติทั่วไป
      dqCount: 0, knockouts: 0, offSide: 0, offBack: 0, folded: 0,
      outOfBounds: 0, collisions: 0, reshuffles: 0, cardsFlipped: 0,
      winner: null, places: {},
      // เงื่อนไข side bet ที่ต้องเฝ้าดูตลอดเรซ
      twoFallen: false,            // ล้มพร้อมกัน >= 2 ตัว
      twoAtLine: false,            // อยู่ช่องติดเส้นชัยพร้อมกัน >= 2 ตัว
      sameSpace: false,            // หยุดช่องเดียวกัน >= 2 ตัว
      crawlFinalStretch: false,    // คลานในช่วงสุดท้าย
      finalStretchEmptyAtWin: false,
    };

    this.burnThree();
  }

  burnThree() {
    this.burned = this.deck.splice(0, 3);
    this.log({ t: 'burn', count: this.burned.length });
  }

  log(e) {
    this.raceLog.push(e);
    if (this.raceFeed) this.raceFeed.push(e);
  }

  mascot(id) { return this.mascots.find((m) => m.id === id); }
  get racing() { return this.mascots.filter((m) => m.status === 'racing'); }
  get resolvedCount() { return this.mascots.filter((m) => m.status !== 'racing').length; }

  // ---- เปิดไพ่ 1 ใบ ----
  flip() {
    if (this.phase !== 'racing') throw new Error('ยังไม่ได้แข่ง');
    if (this.deck.length === 0) {
      this.reshuffle();
      if (this.phase !== 'racing') return { card: null, log: this.takeLog() };
    }
    const card = this.deck.shift();
    this.discard.push(card);
    this.cardsFlipped += 1;
    this.summary.cardsFlipped = this.cardsFlipped;
    this.log({ t: 'flip', card });
    this.applyCard(card);
    this.checkSimultaneous();
    this.checkRaceEnd();
    return { card, log: this.takeLog() };
  }

  takeLog() { const l = this.raceLog; this.raceLog = []; return l; }

  // เงื่อนไข side bet ที่เป็น "สถานะพร้อมกัน" — ตรวจตอนไพ่ใบนั้นทำงานเสร็จ
  checkSimultaneous() {
    const racing = this.racing;
    if (racing.filter((m) => m.fallen).length >= 2) this.summary.twoFallen = true;
    if (racing.filter((m) => m.pos === D.TRACK.finishAt - 1).length >= 2) this.summary.twoAtLine = true;
    const seen = new Set();
    for (const m of racing) {
      const k = m.lane + ':' + m.pos;
      if (seen.has(k)) { this.summary.sameSpace = true; break; }
      seen.add(k);
    }
  }

  // ---- สับใหม่ + พับสนาม ----
  reshuffle() {
    this.summary.reshuffles += 1;
    // พับเสื่อไปที่เส้นทึบถัดไป
    // เมื่อใช้เส้นครบแล้ว (เสื่อจริงพับต่อไม่ได้) ให้บีบทีละช่องแทน
    // เพื่อไม่ให้เรซวนไม่รู้จบในกรณีที่มาสคอตติดกับกันเอง
    const fold = D.TRACK.foldLines[this.foldStep];
    if (fold !== undefined) {
      this.backEdge = fold;
      this.foldStep += 1;
    } else {
      this.backEdge = Math.min(this.backEdge + 1, D.TRACK.length - 1);
      this.foldStep += 1;
    }
    this.log({ t: 'fold', backEdge: this.backEdge });
    for (const m of this.racing) {
      if (m.pos < this.backEdge) this.dq(m, 'folded');
    }
    this.checkRaceEnd();
    if (this.phase !== 'racing') return;
    this.deck = shuffle(this.fullDeck, this.rng);
    this.discard = [];
    this.burnThree();
    this.log({ t: 'reshuffle' });
  }

  // ---- ใช้ผลของไพ่ ----
  applyCard(card) {
    if (card.type === 'multi') {
      this.summary.multiFlipped += 1;
      for (const m of this.racing) if (card.recover) this.recover(m);
      if (card.amount) {
        for (const m of [...this.racing]) {
          this.move(m, card.amount, { noCollide: true, noFinish: true });
        }
      }
      return;
    }
    const m = this.mascot(card.target);
    if (!m || m.status !== 'racing') return;

    switch (card.type) {
      case 'move':
        this.move(m, card.amount);
        break;
      case 'star':
        this.starMove(m);
        break;
      case 'fall':
        this.fall(m);
        break;
      case 'turn':
        m.facing *= -1;
        this.log({ t: 'turn', id: m.id, facing: m.facing });
        break;
      case 'swerve':
        this.move(m, card.amount);
        if (m.status === 'racing') this.swerve(m, card.dir);
        break;
      case 'recover':
        this.recover(m);
        if (card.amount) this.move(m, card.amount);
        break;
    }
  }

  // ---- ลุกขึ้น / หันกลับ ----
  recover(m) {
    if (!m.fallen && m.facing === 1) return;
    m.fallen = false;
    m.facing = 1;
    this.log({ t: 'recover', id: m.id });
  }

  // ---- ล้ม ----
  fall(m) {
    if (m.status !== 'racing') return;
    if (m.fallen) { this.dq(m, 'knockout'); return; }
    m.fallen = true;
    this.log({ t: 'fall', id: m.id });
  }

  // ---- เดิน n ช่อง ----
  move(m, amount, opts = {}) {
    if (m.status !== 'racing' || amount === 0) return;
    let steps = Math.abs(amount);
    if (m.fallen) steps = Math.min(steps, 1); // ล้มแล้วคลานได้ทีละช่อง
    const dir = Math.sign(amount) * m.facing;
    const from = { lane: m.lane, pos: m.pos };

    for (let i = 0; i < steps; i++) {
      const next = m.pos + dir;
      if (next >= D.TRACK.finishAt) {
        if (opts.noFinish) { m.pos = D.TRACK.finishAt - 1; break; }
        m.pos = D.TRACK.finishAt;
        this.noteCrawl(m, from);
        this.finish(m);
        return;
      }
      if (next < this.backEdge) { this.dq(m, 'offBack'); return; }
      m.pos = next;
      if (!opts.noCollide) {
        this.collide(m);
        if (m.status !== 'racing') return;
      }
    }
    this.log({ t: 'move', id: m.id, from, to: { lane: m.lane, pos: m.pos } });
    this.noteCrawl(m, from);
  }

  // ---- คลาน (ล้มแล้วยังเคลื่อนที่) ในช่วงสุดท้ายหรือเปล่า ----
  // นับทั้งเข้า ออก และอยู่ในช่วงสุดท้าย
  noteCrawl(m, from) {
    if (!m.fallen) return;
    const fs = D.TRACK.finalStretch;
    if (from.pos >= fs || m.pos >= fs) this.summary.crawlFinalStretch = true;
  }

  // ---- เดินไปดาวดวงถัดไป ----
  starMove(m) {
    if (m.fallen) { this.move(m, 1); return; }
    const dir = m.facing;
    const stars = D.TRACK.stars[m.lane];
    let target = null;
    if (dir > 0) {
      target = stars.find((s) => s > m.pos) ?? null;
    } else {
      const behind = stars.filter((s) => s < m.pos && s >= this.backEdge);
      target = behind.length ? behind[behind.length - 1] : null;
    }
    if (target === null) { this.log({ t: 'nostar', id: m.id }); return; }
    this.move(m, (target - m.pos) * m.facing);
  }

  // ---- ปัดเข้าเลนข้าง ----
  swerve(m, dir) {
    const delta = (dir === 'R' ? 1 : -1) * m.facing;
    const newLane = m.lane + delta;
    this.log({ t: 'swerve', id: m.id, from: m.lane, to: newLane });
    if (newLane < 0 || newLane > 3) { this.dq(m, 'offSide'); return; }
    m.lane = newLane;
    this.collide(m);
  }

  // ---- ตรวจการชน (ตัวที่หยุดนิ่งเป็นฝ่ายล้ม) ----
  collide(m) {
    const others = this.mascots.filter(
      (o) => o !== m && o.status === 'racing' && o.lane === m.lane && o.pos === m.pos
    );
    for (const o of others) {
      this.summary.collisions += 1;
      this.log({ t: 'collide', by: m.id, id: o.id });
      this.fall(o);
    }
  }

  // ---- เข้าเส้นชัย ----
  finish(m) {
    m.status = 'finished';
    const place = this.podium.findIndex((x) => x === null); // ที่ว่างสูงสุด
    this.podium[place] = m.id;
    m.place = place + 1;
    if (m.place === 1) {
      this.summary.winner = m.id;
      // ตอนนี้ m ออกจาก racing แล้ว เหลือแต่ตัวอื่น
      this.summary.finalStretchEmptyAtWin =
        !this.racing.some((o) => o.pos >= D.TRACK.finalStretch);
    }
    this.log({ t: 'finish', id: m.id, place: m.place });
  }

  // ---- ปรับแพ้ ----
  dq(m, reason) {
    if (m.status !== 'racing') return;
    m.status = 'dq';
    this.summary.dqCount += 1;
    if (reason === 'knockout') this.summary.knockouts += 1;
    if (reason === 'offSide') this.summary.offSide += 1;
    if (reason === 'offBack') this.summary.offBack += 1;
    if (reason === 'folded') this.summary.folded += 1;
    // การ์ด side bet นับ "ออกนอกสนาม" = หลุดท้าย + ตกขอบ + ตกค้างใต้เสื่อ
    if (['offSide', 'offBack', 'folded'].includes(reason)) this.summary.outOfBounds += 1;
    // ลงอันดับต่ำสุดที่ยังว่าง
    let place = 3;
    while (place >= 0 && this.podium[place] !== null) place -= 1;
    this.podium[place] = m.id;
    m.place = place + 1;
    this.log({ t: 'dq', id: m.id, reason, place: m.place });
  }

  // ---- จบการแข่ง ----
  checkRaceEnd() {
    if (this.phase !== 'racing') return;
    if (this.resolvedCount < 3) return;
    const left = this.racing[0];
    if (left) {
      const place = this.podium.findIndex((x) => x === null);
      this.podium[place] = left.id;
      left.place = place + 1;
      left.status = 'finished';
      this.log({ t: 'placed', id: left.id, place: left.place });
    }
    for (const m of this.mascots) this.summary.places[m.id] = m.place;
    this.phase = 'payout';
    this.computePayouts();
  }

  // ---------- จ่ายเงิน ----------
  computePayouts() {
    const sideBet = this.currentSideBet;
    const sideAnswer = sideBet.resolve(this.summary) ? 'YES' : 'NO';
    this.sideAnswer = sideAnswer;
    this.payouts = [];

    for (const p of this.players) {
      const lines = [];
      for (const t of p.tickets) {
        let amount = 0;
        let note = '';
        if (t.kind === 'mascot') {
          const m = this.mascot(t.mascot);
          const place = m.place;
          amount = place <= 3 ? t.values[t.mode][place - 1] : 0;
          note = `อันดับ ${place}`;
        } else {
          const correct = t.answer === sideAnswer;
          amount = t.values[t.mode][correct ? 0 : 1];
          note = correct ? 'ทายถูก' : 'ทายผิด';
        }
        const doubled = this.raceNo === 3 && p.doubledTicket === t.id;
        if (doubled) amount *= 2;
        lines.push({ ticket: t, amount, note, doubled });
      }
      const total = lines.reduce((s, l) => s + l.amount, 0);
      p.money = Math.max(0, p.money + total);
      p.log.push({ race: this.raceNo, total, lines });
      this.payouts.push({ playerId: p.id, lines, total, money: p.money });
    }
  }

  setDouble(playerId, ticketId) {
    if (this.raceNo !== 3) throw new Error('ใช้ได้เฉพาะเรซที่ 3');
    const p = this.player(playerId);
    if (!p.tickets.some((t) => t.id === ticketId)) throw new Error('ไม่มีตั๋วใบนี้');
    p.doubledTicket = ticketId;
  }

  // ---------- เรซถัดไป ----------
  nextRace() {
    if (this.phase !== 'payout') throw new Error('ยังจ่ายเงินไม่เสร็จ');
    if (this.raceNo >= D.TOTAL_RACES) { this.phase = 'results'; return; }

    // ไพ่ทั้งหมดกลับเข้าสำรับ แล้วแจกคนละ 1 ใบจากสำรับ (ตามกติกา)
    this.raceDeck = shuffle(this.fullDeck, this.rng);
    const draw = this.n === 2 ? 2 : 1;
    for (const p of this.players) {
      p.hand.push(...this.raceDeck.splice(0, draw));
    }
    this.sideBetIndex += 1;
    this.firstDrafter = (this.firstDrafter + 1) % this.n;
    this.beginBetting();
  }

  // ---------- state ที่ส่งให้ client ----------
  publicState() {
    return {
      phase: this.phase,
      raceNo: this.raceNo,
      totalRaces: D.TOTAL_RACES,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, money: p.money,
        handCount: p.hand.length,
        tickets: p.tickets,
        doubledTicket: p.doubledTicket,
        submitted: !!p.submitted,
      })),
      stacks: this.stacks
        ? Object.fromEntries(Object.entries(this.stacks).map(([k, v]) => [k, v]))
        : null,
      draft: this.phase === 'betting'
        ? {
            currentPlayerId: this.currentDrafter?.id ?? null,
            pending: this.pendingTicket
              ? { playerId: this.pendingTicket.playerId, ticket: this.pendingTicket.ticket }
              : null,
            picksLeft: this.draftOrder.length - this.draftIndex,
          }
        : null,
      raceDeck: this.raceDeck ?? null,          // สำรับหงาย ทุกคนเห็น
      deckLeft: this.deck ? this.deck.length : null,
      cardsFlipped: this.cardsFlipped ?? 0,
      lastCard: this.discard?.length ? this.discard[this.discard.length - 1] : null,
      mascots: this.mascots ?? null,
      podium: this.podium ?? null,
      backEdge: this.backEdge ?? 0,
      track: {
        length: D.TRACK.length,
        start: D.TRACK.start,
        finishAt: D.TRACK.finishAt,
        stars: D.TRACK.stars,
        sectionLines: D.TRACK.sectionLines,
        finalStretch: D.TRACK.finalStretch,
      },
      feed: this.raceFeed ? this.raceFeed.slice(-14) : [],
      sideBet: this.currentSideBet,
      sideAnswer: this.phase === 'payout' || this.phase === 'results' ? this.sideAnswer : null,
      payouts: this.phase === 'payout' ? this.payouts : null,
      summary: this.phase === 'payout' ? this.summary : null,
      cardsToSubmit: this.cardsToSubmit ?? 1,
    };
  }

  privateState(playerId) {
    const p = this.player(playerId);
    if (!p) return null;
    return { hand: p.hand, tickets: p.tickets, money: p.money, doubledTicket: p.doubledTicket };
  }
}

module.exports = { Game, shuffle };
