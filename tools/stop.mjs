// Stops the STRATOS dev/preview server(s) listening on the local ports.
// Only processes whose command line contains vite (or this project) are
// terminated, so an unrelated app on the same port is left alone.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORTS = [5173, 4173, 5174, 5175];
const isWindows = process.platform === 'win32';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function listeningPidsWindows(port) {
  const out = run('netstat -ano -p TCP');
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes('LISTENING')) continue;
    const parts = line.trim().split(/\s+/);
    const local = parts[1] || '';
    if (!local.endsWith(`:${port}`)) continue;
    const pid = Number(parts[parts.length - 1]);
    if (pid > 0) pids.add(pid);
  }
  return [...pids];
}

function listeningPidsUnix(port) {
  const out = run(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
  return out
    .split(/\s+/)
    .map(Number)
    .filter((n) => n > 0);
}

function commandLine(pid) {
  if (isWindows) {
    const ps = run(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId=${pid}\\").CommandLine"`
    );
    return ps.trim();
  }
  return run(`ps -p ${pid} -o command=`).trim();
}

function stopPid(pid) {
  const cmd = commandLine(pid);
  const ours = /vite|Flight_Sim|flight_sim|tools[\\/]stop/i.test(cmd);
  if (!ours) {
    console.log(`· port process ${pid} is not the sim (${cmd.slice(0, 80) || 'unknown'}); leaving it running`);
    return false;
  }
  if (isWindows) run(`taskkill /PID ${pid} /T /F`);
  else run(`kill -TERM ${pid}`);
  console.log(`✓ stopped sim server (pid ${pid})`);
  return true;
}

let stopped = 0;
for (const port of PORTS) {
  const pids = isWindows ? listeningPidsWindows(port) : listeningPidsUnix(port);
  for (const pid of pids) {
    if (stopPid(pid)) stopped++;
  }
}

if (stopped === 0) {
  console.log('Nothing on ports 5173–5175 is running the sim — it is already stopped.');
} else {
  console.log(`STRATOS stopped. Project: ${projectRoot}`);
}
