// Headless Chrome driver for visual verification.
// Usage:
//   node tools/shoot.mjs out.png [expression] [waitMs] [width] [height]
//   node tools/shoot.mjs out.png '[{"expr":"...","wait":4000,"out":"a.png"}, ...]'
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = process.argv[2] || 'screenshots/shot.png';
const stepArg = process.argv[3] || '';
const steps = stepArg.trim().startsWith('[')
  ? JSON.parse(stepArg)
  : [{ expr: stepArg, wait: Number(process.argv[4] || 6000), out }];
const width = Number(process.argv[5] || 1280);
const height = Number(process.argv[6] || 760);
const port = 9411 + (process.pid % 200);
const url = process.env.SIM_URL || 'http://localhost:5173/';

mkdirSync(dirname(out), { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-extensions',
  '--no-first-run',
  `--window-size=${width},${height}`,
  '--force-device-scale-factor=1',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${process.env.TEMP || '/tmp'}/cdp-profile-${port}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome devtools did not come up');
}

const wsUrl = await getTarget();
const ws = new WebSocket(wsUrl);
let seq = 0;
const pending = new Map();
const errors = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push(`EXCEPTION ${d.text} ${d.exception?.description || ''}`.split('\n').slice(0, 4).join('\n'));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    if (!text.includes('warning X4122')) errors.push(`console.${msg.params.type}: ${text}`);
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

const shotsScale = Number(process.env.SHOT_SCALE || 1);

async function shoot(path) {
  const params = { format: 'png', fromSurface: true };
  if (shotsScale !== 1) {
    params.clip = { x: 0, y: 0, width, height, scale: shotsScale };
  }
  const shot = await send('Page.captureScreenshot', params);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url });

let state = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  try {
    state = await evaluate('window.game ? window.game.state : "boot"');
  } catch {}
  if (state === 'menu') break;
}

const keys = [];
for (const step of steps) {
  if (step.expr) {
    try {
      await evaluate(step.expr);
    } catch (e) {
      errors.push(`STEP FAILED: ${e.message}`);
    }
  }
  if (step.wait) await sleep(step.wait);
  if (step.out) await shoot(step.out);
  if (step.log !== undefined) {
    try {
      keys.push({ label: step.log, value: await evaluate(step.log) });
    } catch (e) {
      keys.push({ label: step.log, error: e.message });
    }
  }
}
if (!steps.some((s) => s.out)) await shoot(out);

let fps = null;
try {
  fps = await evaluate('Math.round(window.game.fps)');
} catch {}
console.log(JSON.stringify({ state, fps, keys, errors: errors.slice(0, 12) }, null, 2));

ws.close();
chrome.kill();
process.exit(0);
