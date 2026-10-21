'use strict';
// ============================================================
//  npm run share
//  Starts the game server AND a Cloudflare quick tunnel, then prints a public
//  https://xxxx.trycloudflare.com URL you can send to friends (no account needed).
//  The URL works while this window stays open; it changes every time.
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
process.env.PORT = String(PORT);

function findCloudflared() {
  const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const local = path.join(__dirname, '.cloudflared', name);
  return fs.existsSync(local) ? local : 'cloudflared'; // fall back to PATH
}

function openBrowser(url) {
  if (process.env.NO_OPEN || process.argv.includes('--no-open')) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
}

function banner(url) {
  const line = '='.repeat(64);
  console.log(`\n${line}`);
  console.log('  友達にこのURLを送ってください（スマホでもOK）:');
  console.log(`\n      ${url}\n`);
  console.log('  ・ルームを作ると、ロビーの「招待リンク」にこのURL入りのリンクが出ます');
  console.log('  ・開けないときは 10〜30秒ほど待ってから再読み込みしてください');
  console.log('  ・このウィンドウを閉じると公開も終了します（URLは毎回変わります）');
  console.log(`${line}\n`);
}

// 1) game server (same process, so it can read PUBLIC_URL for invite links)
require('./server.js');

// 2) Cloudflare quick tunnel
const exe = findCloudflared();
console.log('Cloudflare トンネルを起動しています…');
const cf = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let shuttingDown = false;
let found = false;

const onData = (buf) => {
  const text = buf.toString();
  if (process.env.DEBUG_TUNNEL) process.stderr.write(text);
  const m = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/i.exec(text);
  if (m && !found) {
    found = true;
    process.env.PUBLIC_URL = m[0];
    banner(m[0]);
    openBrowser(`http://localhost:${PORT}`);
  }
};
cf.stdout.on('data', onData);
cf.stderr.on('data', onData);

cf.on('error', (err) => {
  console.error(`cloudflared を起動できませんでした: ${err.message}`);
  console.error('.cloudflared/cloudflared.exe を置くか、cloudflared をインストールしてください。');
  console.error(`ゲームサーバーはローカル (http://localhost:${PORT}) でのみ動作しています。`);
});
cf.on('exit', (code) => {
  if (!shuttingDown) console.error(`トンネルが終了しました (code ${code})。ゲームはローカルでのみ遊べます。`);
});

const shutdown = () => {
  shuttingDown = true;
  try { cf.kill(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
