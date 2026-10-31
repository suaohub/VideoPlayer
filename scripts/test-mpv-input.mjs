import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { once } from 'node:events';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = resolve(tmpdir());
const testDirectory = await mkdtemp(join(temporaryRoot, 'medianest-mpv-input-test-'));
const defaultMpv = 'C:\\Program Files\\MPV Player\\mpv.exe';
const binary = process.env.MPV_BIN || (existsSync(defaultMpv) ? defaultMpv : 'mpv');
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function checkExitKey(key, inputPath, playlist) {
  const pipe = process.platform === 'win32'
    ? `\\\\.\\pipe\\medianest-input-test-${process.pid}-${key}`
    : join(testDirectory, `${key}.sock`);
  const child = spawn(binary, [
    '--no-config', '--load-scripts=no', '--no-terminal', '--idle=yes',
    '--vo=null', '--ao=null', '--force-window=no', '--pause=yes', '--keep-open=always',
    `--input-conf=${inputPath}`, `--input-ipc-server=${pipe}`, ...playlist,
  ], { windowsHide: true, stdio: 'ignore' });
  const exited = once(child, 'exit');
  let socket;
  const pending = new Map();
  let requestId = 0;
  let buffer = '';
  const deadline = Date.now() + 8000;
  const command = (command) => new Promise((resolveCommand, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${command[0]} timed out`)); }, 2000);
    pending.set(id, (response) => {
      clearTimeout(timer);
      if (response.error === 'success') resolveCommand(response.data);
      else reject(new Error(`${command[0]}: ${response.error}`));
    });
    socket.write(JSON.stringify({ command, request_id: id }) + '\n');
  });
  const watchdog = setTimeout(() => { child.kill(); }, 10000);
  try {
    while (!socket) {
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`${key}: mpv IPC did not start`);
      try {
        socket = await new Promise((resolveSocket, reject) => {
          const attempt = connect(pipe);
          attempt.once('connect', () => resolveSocket(attempt));
          attempt.once('error', (error) => { attempt.destroy(); reject(error); });
        });
      } catch { await delay(50); }
    }
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const response = JSON.parse(line);
        const callback = pending.get(response.request_id);
        if (callback) { pending.delete(response.request_id); callback(response); }
      }
    });
    const bindings = await command(['get_property', 'input-bindings']);
    for (const [name, expected] of [
      [key, 'quit'], ['LEFT', 'seek -5 relative+keyframes'], ['RIGHT', 'seek 5 relative+keyframes'],
    ]) {
      if (!bindings.some((binding) => binding.key === name && !binding.is_weak && binding.cmd === expected)) {
        throw new Error(`${name} does not have the required startup binding`);
      }
    }
    while (await command(['get_property', 'playlist-count']) !== 2
        || await command(['get_property', 'playlist-pos']) !== 0) {
      if (Date.now() > deadline) throw new Error('Synthetic playlist did not load its first item');
      await delay(50);
    }
    // Use the real mpv input dispatcher, without loading any private media or opening a video window.
    socket.write(JSON.stringify({ command: ['keypress', key] }) + '\n');
    const [code] = await Promise.race([
      exited,
      delay(2500).then(() => { throw new Error(`${key} did not exit mpv; it may have advanced the playlist`); }),
    ]);
    if (code !== 0) throw new Error(`${key}: unexpected mpv exit code ${code}`);
    console.log(`PASS ${key} exits mpv instead of advancing its two-item playlist; seek bindings load at startup`);
  } finally {
    clearTimeout(watchdog);
    socket?.destroy();
    if (child.exitCode === null) { child.kill(); await exited; }
  }
}

try {
  const modulePath = join(testDirectory, 'mpvInput.mjs');
  await build({ absWorkingDir: projectRoot, entryPoints: ['electron/mpvInput.ts'],
    bundle: true, platform: 'node', format: 'esm', outfile: modulePath });
  const { ensureMpvInputConfig } = await import(pathToFileURL(modulePath).href);
  const inputPath = ensureMpvInputConfig(testDirectory);
  // One second of synthetic silence is sufficient because playback starts paused.
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  const playlist = [join(testDirectory, 'synthetic-a.wav'), join(testDirectory, 'synthetic-b.wav')];
  await Promise.all(playlist.map((file) => writeFile(file, wav)));
  await checkExitKey('ENTER', inputPath, playlist);
  await checkExitKey('KP_ENTER', inputPath, playlist);
} finally {
  const relativeTarget = relative(temporaryRoot, resolve(testDirectory));
  if (!relativeTarget || isAbsolute(relativeTarget) || relativeTarget.startsWith('..')
      || !basename(testDirectory).startsWith('medianest-mpv-input-test-')) {
    throw new Error('Refusing to clean an unexpected test directory');
  }
  await rm(testDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
