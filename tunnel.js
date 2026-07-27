// เปิดเซิร์ฟเวอร์ + เจาะ tunnel ออกอินเทอร์เน็ต ได้ลิงก์ https สาธารณะทันที
// ใช้เมื่อเพื่อนไม่ได้อยู่ Wi-Fi วงเดียวกัน  →  npm run tunnel
const { spawn } = require('child_process');
const os = require('os');
const qrTerminal = require('qrcode-terminal');

const lanURL = () => {
  const ip = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address)[0];
  return ip ? `http://${ip}:${PORT}` : `http://localhost:${PORT}`;
};

const PORT = process.env.PORT || 3000;

function box(lines) {
  const w = Math.max(...lines.map((l) => [...l].length)) + 4;
  console.log('\n  ┌' + '─'.repeat(w) + '┐');
  for (const l of lines) console.log('  │  ' + l + ' '.repeat(w - [...l].length - 3) + '│');
  console.log('  └' + '─'.repeat(w) + '┘\n');
}

// ---------- 1. เปิดเซิร์ฟเวอร์ ----------
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, HS_QUIET: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
console.log(`\n  เปิดเซิร์ฟเวอร์ที่ http://localhost:${PORT} แล้ว`);

// ---------- 2. หา cloudflared ----------
let bin = null;
try {
  const cf = require('cloudflared');
  if (require('fs').existsSync(cf.bin)) bin = cf.bin;
} catch { /* ไม่มี package ก็ไม่เป็นไร */ }

if (!bin) {
  box([
    'ยังไม่มี cloudflared บนเครื่องนี้',
    '',
    'ลองสั่ง:  npm install cloudflared',
    '',
    'หรือติดตั้งเองก็ได้:',
    '  macOS    brew install cloudflared',
    '  Windows  winget install Cloudflare.cloudflared',
    '',
    'ระหว่างนี้เซิร์ฟเวอร์ยังเปิดอยู่ที่ localhost:' + PORT,
    'เพื่อนใน Wi-Fi วงเดียวกันเข้าเล่นได้ตามปกติ',
  ]);
  qrTerminal.generate(lanURL(), { small: true }, (qr) => {
    console.log(qr.split('\n').map((l) => '     ' + l).join('\n'));
    console.log(`     ${lanURL()}\n`);
  });
  process.on('SIGINT', () => { server.kill(); process.exit(0); });
} else {

  console.log('  กำลังเจาะ tunnel ออกอินเทอร์เน็ต… (ใช้เวลาสักครู่)\n');

  // ---------- 3. เปิด quick tunnel ----------
  const tun = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate']);

  let found = false;
  const scan = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!m || found) return;
    found = true;
    const url = m[0];
    qrTerminal.generate(url, { small: true }, (qr) => {
      console.log(qr.split('\n').map((l) => '     ' + l).join('\n'));
      box([
        'ลิงก์สาธารณะพร้อมแล้ว — ส่งให้เพื่อนได้เลย',
        '',
        url,
        '',
        'ใครก็เข้าได้ ไม่ต้องอยู่ Wi-Fi เดียวกัน',
        'ลิงก์นี้อยู่ได้จนกว่าจะกด Ctrl+C',
      ]);
    });
  };
  tun.stdout.on('data', scan);
  tun.stderr.on('data', scan);

  // ถ้าเจาะ tunnel ไม่ได้ ก็ยังเล่นใน Wi-Fi วงเดียวกันได้อยู่ — บอกลิงก์ LAN ให้เลย
  const timeout = setTimeout(() => {
    if (found) return;
    const url = lanURL();
    console.log('  ยังต่อ tunnel ไม่ได้ (เช็คอินเทอร์เน็ตหรือไฟร์วอลล์)');
    console.log('  แต่เซิร์ฟเวอร์ยังเปิดอยู่ ใช้เล่นใน Wi-Fi วงเดียวกันได้ตามปกติ:\n');
    qrTerminal.generate(url, { small: true }, (qr) => {
      console.log(qr.split('\n').map((l) => '     ' + l).join('\n'));
      console.log(`     ${url}\n`);
    });
  }, 30000);

  // ---------- 4. ปิดให้เรียบร้อยตอน Ctrl+C ----------
  const bye = () => {
    clearTimeout(timeout);
    console.log('\n  ปิดเซิร์ฟเวอร์และ tunnel แล้ว');
    tun.kill(); server.kill();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  server.on('exit', bye);
}
