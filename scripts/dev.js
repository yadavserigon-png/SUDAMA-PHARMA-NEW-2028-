// Starts the API (port 5000) and the website (port 5173) together. Ctrl+C stops both.
const { spawn } = require('child_process');
const path = require('path');

const isWin = process.platform === 'win32';
const run = (name, dir, color) => {
  const p = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], { cwd: path.join(__dirname, '..', dir), shell: isWin });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  p.stdout.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n'));
  p.stderr.on('data', (d) => process.stderr.write(tag + d));
  p.on('exit', (c) => console.log(`${tag}exited with code ${c}`));
  return p;
};
const procs = [run('api', 'backend', 32), run('web', 'frontend', 36)];
process.on('SIGINT', () => { procs.forEach((p) => p.kill()); process.exit(0); });
