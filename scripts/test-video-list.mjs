import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import electronPath from 'electron';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = resolve(tmpdir());
const testDirectory = await mkdtemp(join(temporaryRoot, 'medianest-video-list-test-'));

try {
  await build({
    absWorkingDir: projectRoot, entryPoints: ['tests/videoList.fixture.tsx'],
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    outfile: join(testDirectory, 'fixture.js'),
    plugins: [{
      name: 'isolated-player-events',
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/api$/ }, () => ({ path: 'fixture-api', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `const stopped = new Set();
            export const api = { onStopped: cb => { stopped.add(cb); return () => stopped.delete(cb); } };
            window.emitMpvStopped = () => { for (const cb of stopped) cb(); };`, loader: 'js',
        }));
      },
    }],
  });
  await writeFile(join(testDirectory, 'index.html'), `<!doctype html>
    <html data-theme="day"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css">
    <style>html,body,#root{height:100%;margin:0;overflow:hidden}#root{opacity:1!important;visibility:visible!important}</style>
    </head><body><div id="root"></div><script>
    window.rowDateFormats=0;
    const originalDateFormat=Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString=function(...args){window.rowDateFormats++;return originalDateFormat.apply(this,args)};
    </script><script src="fixture.js"></script></body></html>`);

  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  let diagnostics = '';
  const exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(electronPath, [join(projectRoot, 'tests/videoList.electron.cjs'), testDirectory], {
      env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Virtual list test timed out')); }, 45000);
    child.stdout.on('data', (chunk) => { diagnostics += chunk; });
    child.stderr.on('data', (chunk) => { diagnostics += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => { clearTimeout(timer); resolveExit(code); });
  });
  const result = JSON.parse(await readFile(join(testDirectory, 'results.json'), 'utf8'));
  if (exitCode !== 0 || !result.success) throw new Error(result.error || diagnostics);
  for (const resultCase of result.results) console.log(`PASS ${resultCase.check}${resultCase.mounted ? ` (${resultCase.mounted} rows mounted)` : ''}`);
} finally {
  // Verify the computed deletion target is our own directory inside the OS temp folder.
  const relativeTarget = relative(temporaryRoot, resolve(testDirectory));
  if (!relativeTarget || isAbsolute(relativeTarget) || relativeTarget.startsWith('..')
      || !basename(testDirectory).startsWith('medianest-video-list-test-')) {
    throw new Error('Refusing to clean an unexpected test directory');
  }
  await rm(testDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
