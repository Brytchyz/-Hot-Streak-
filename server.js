const express = require('express');
const http = require('http');
const os = require('os');
const { Server } = require('socket.io');
const QR = require('qrcode');
const qrTerminal = require('qrcode-terminal');
const { Game } = require('./src/engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ============================================================
// ห้อง
// ============================================================
/** @type {Map<string, Room>} */
const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ตัดตัวที่อ่านสับสน
function newCode() {
  let code;
  do {
    code = [...Array(4)].map(() => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = [];   // { id, name, socketId, connected } — ไม่รวมเจ้ามือ
    this.hostSocketId = null; // จอเจ้ามือ (บอร์ด) — คุมเกมได้ แต่ไม่ใช่ผู้เล่น
    this.game = null;
    this.autoplay = false;
    this.timer = null;
    this.createdAt = Date.now();
    this.origin = null;   // client เป็นคนบอกว่าเข้ามาทาง URL ไหน
    this.joinUrl = null;
    this.qr = null;
  }

  addPlayer(name, playerId) {
    const existing = this.players.find((p) => p.id === playerId);
    if (existing) return existing;
    const p = { id: playerId, name, socketId: null, connected: false };
    this.players.push(p);
    return p;
  }

  // สร้าง QR ของลิงก์เข้าห้อง โดยใช้ origin ที่ client รายงานมา
  // (ทำให้ใช้ได้ทั้ง LAN, Cloudflare tunnel, และ deploy จริง โดยไม่ต้องตั้งค่า)
  async setOrigin(origin) {
    if (!origin || this.origin === origin) return;
    this.origin = origin;
    this.joinUrl = `${origin}/?r=${this.code}`;
    try {
      this.qr = await QR.toString(this.joinUrl, {
        type: 'svg', margin: 1, errorCorrectionLevel: 'M',
        color: { dark: '#0C2318', light: '#F0EDE1' },
      });
    } catch { this.qr = null; }
  }

  lobbyState() {
    return {
      code: this.code,
      started: !!this.game,
      joinUrl: this.joinUrl,
      qr: this.qr,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, connected: p.connected,
      })),
    };
  }

  broadcast() {
    const lobby = this.lobbyState();
    const pub = this.game ? this.game.publicState() : null;
    for (const p of this.players) {
      if (!p.socketId) continue;
      io.to(p.socketId).emit('state', {
        lobby,
        game: pub,
        you: this.game ? this.game.privateState(p.id) : null,
        yourId: p.id,
        isHost: false,
        autoplay: this.autoplay,
      });
    }
    if (this.hostSocketId) {
      io.to(this.hostSocketId).emit('state', {
        lobby, game: pub, you: null, yourId: null, isHost: true, autoplay: this.autoplay,
      });
    }
  }

  stopAuto() {
    this.autoplay = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  startAuto(ms = 1800) {
    this.stopAuto();
    this.autoplay = true;
    this.timer = setInterval(() => {
      if (!this.game || this.game.phase !== 'racing') { this.stopAuto(); this.broadcast(); return; }
      try {
        this.game.flip();
      } catch (e) {
        this.stopAuto();
      }
      this.broadcast();
      if (this.game.phase !== 'racing') this.stopAuto();
    }, ms);
  }
}

// ============================================================
// Socket
// ============================================================
io.on('connection', (socket) => {
  let room = null;
  let me = null;
  let isHostCtrl = false;

  const fail = (msg) => socket.emit('err', msg);

  // จอเจ้ามือ (บอร์ด) — สร้างห้องใหม่ (ไม่ส่ง code) หรือกลับมาคุมห้องเดิม (ส่ง code)
  // เจ้ามือไม่ใช่ผู้เล่น ไม่มีชื่อในลิสต์ ไม่มีไพ่ ไม่มีตั๋ว
  socket.on('host', async ({ code, origin }) => {
    let r;
    if (code) {
      r = rooms.get((code || '').toUpperCase().trim());
      if (!r) return fail('ไม่พบห้องนี้ ลองเช็ครหัสอีกที');
    } else {
      r = new Room(newCode());
      rooms.set(r.code, r);
    }
    await r.setOrigin(origin);
    room = r;
    isHostCtrl = true;
    r.hostSocketId = socket.id;
    socket.join(r.code);
    socket.emit('joined', { code: r.code });
    r.broadcast();
  });

  const attach = (r, player) => {
    room = r;
    me = player;
    player.socketId = socket.id;
    player.connected = true;
    socket.join(r.code);
    socket.emit('joined', { code: r.code, playerId: player.id });
    r.broadcast();
  };

  socket.on('join', async ({ code, name, playerId, origin }) => {
    const r = rooms.get((code || '').toUpperCase().trim());
    if (!r) return fail('ไม่พบห้องนี้ ลองเช็ครหัสอีกที');
    if (!r.origin) await r.setOrigin(origin);
    const existing = r.players.find((p) => p.id === playerId);
    if (existing) return attach(r, existing);           // กลับเข้ามาใหม่
    if (r.game) return fail('ห้องนี้เริ่มเกมไปแล้ว');
    if (r.players.length >= 8) return fail('ห้องเต็มแล้ว (สูงสุด 8 คน)');
    if (!name || !name.trim()) return fail('ใส่ชื่อก่อนนะ');
    attach(r, r.addPlayer(name.trim().slice(0, 14), playerId));
  });

  // การกระทำของผู้เล่น (แทงพนัน/ใส่ไพ่) — ต้องเป็นผู้เล่นในห้อง
  const guard = (fn) => (...args) => {
    if (!room || !me) return fail('ยังไม่ได้เข้าห้อง');
    try { fn(...args); room.broadcast(); }
    catch (e) { fail(e.message); }
  };

  // การกระทำของเจ้ามือ (คุมเกม) — ต้องเป็นซ็อกเก็ตที่ถือสิทธิ์เจ้ามือของห้องนี้
  const hostGuard = (fn) => (...args) => {
    if (!room || !isHostCtrl || room.hostSocketId !== socket.id) return fail('เฉพาะเจ้ามือเท่านั้น');
    try { fn(...args); room.broadcast(); }
    catch (e) { fail(e.message); }
  };

  socket.on('start', hostGuard(() => {
    if (room.game) throw new Error('เริ่มไปแล้ว');
    if (room.players.length < 2) throw new Error('ต้องมีอย่างน้อย 2 คน');
    room.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name })));
    room.game.start();
  }));

  socket.on('kick', hostGuard(({ playerId }) => {
    if (room.game) throw new Error('เริ่มเกมแล้วเอาออกไม่ได้');
    room.players = room.players.filter((p) => p.id !== playerId);
  }));

  socket.on('draft', guard(({ stack }) => room.game.draftTicket(me.id, stack)));
  socket.on('side', guard(({ mode }) => room.game.chooseSide(me.id, mode)));
  socket.on('submit', guard(({ uids }) => room.game.submitCards(me.id, uids)));
  socket.on('double', guard(({ ticketId }) => room.game.setDouble(me.id, ticketId)));

  socket.on('flip', hostGuard(() => room.game.flip()));

  socket.on('auto', hostGuard(({ on, speed }) => {
    if (on) room.startAuto(speed || 1800); else room.stopAuto();
  }));

  socket.on('next', hostGuard(() => room.game.nextRace()));

  socket.on('rematch', hostGuard(() => {
    room.stopAuto();
    room.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name })));
    room.game.start();
  }));

  // จบเกม — เจ้ามือปิดห้องนี้ถาวร ทุกคน (ผู้เล่น+จอเจ้ามือ) เด้งกลับหน้าแรก
  socket.on('end', () => {
    if (!room || !isHostCtrl || room.hostSocketId !== socket.id) return fail('เฉพาะเจ้ามือเท่านั้น');
    room.stopAuto();
    io.to(room.code).emit('ended');
    rooms.delete(room.code);
  });

  socket.on('disconnect', () => {
    if (isHostCtrl) {
      if (room && room.hostSocketId === socket.id) room.hostSocketId = null;
      return;
    }
    if (!room || !me) return;
    me.connected = false;
    me.socketId = null;
    room.broadcast();
    // ห้องที่ไม่มีใครอยู่เกิน 2 ชม. ให้ลบทิ้ง
    setTimeout(() => {
      const r = rooms.get(room.code);
      if (r && r.players.every((p) => !p.connected) && Date.now() - r.createdAt > 2 * 3600e3) {
        r.stopAuto();
        rooms.delete(r.code);
      }
    }, 60e3);
  });
});

// ============================================================
function localIPs() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// ถ้าพอร์ตถูกใช้อยู่แล้ว ให้บอกวิธีแก้แทนที่จะพ่น stack trace
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\n  \u26a0  พอร์ต ${PORT} ถูกใช้อยู่แล้ว — น่าจะเปิดเซิร์ฟเวอร์ค้างไว้อีกหน้าต่าง\n`);
    console.log('     ทางเลือก:');
    console.log('       1. ไปที่หน้าต่างเดิมแล้วกด Ctrl+C เพื่อปิด');
    console.log(`       2. หรือเปิดพอร์ตอื่นแทน:   PORT=3001 npm start`);
    console.log('          (Windows PowerShell:   $env:PORT=3001; npm start)\n');
  } else {
    console.log('\n  \u26a0  เปิดเซิร์ฟเวอร์ไม่สำเร็จ:', e.message, '\n');
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  if (process.env.HS_QUIET) return;   // tunnel.js จะพิมพ์ลิงก์เอง
  const ips = localIPs();
  // Render ตั้ง RENDER_EXTERNAL_URL ให้เองอัตโนมัติ ไม่ต้องตั้งอะไรเพิ่ม
  const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  const lan = publicUrl || (ips[0] ? `http://${ips[0]}:${PORT}` : `http://localhost:${PORT}`);

  console.log('\n  \u{1F3C1}  Hot Streak \u2014 เซิร์ฟเวอร์พร้อมแล้ว\n');
  console.log(`     เปิดบนเครื่องนี้   http://localhost:${PORT}`);
  if (!publicUrl) {
    for (const ip of ips) console.log(`     มือถือในวง Wi-Fi   http://${ip}:${PORT}`);
  } else {
    console.log(`     ลิงก์สาธารณะ       ${publicUrl}`);
  }
  console.log(`     หน้าเจ้ามือ (บอร์ด)  ${lan}/board.html`);

  console.log('\n     ให้เพื่อนสแกน QR นี้ได้เลย:\n');
  qrTerminal.generate(lan, { small: true }, (qr) => {
    console.log(qr.split('\n').map((l) => '     ' + l).join('\n'));
    console.log(`     ${lan}\n`);
    console.log('     เจ้ามือเปิดหน้าบอร์ดแล้วกด "สร้างห้องใหม่" จะได้ QR ห้องอีกอันให้ผู้เล่นสแกน');
    console.log('     กด Ctrl+C เพื่อปิดเซิร์ฟเวอร์\n');
  });
});
