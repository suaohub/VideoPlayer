import esbuild from 'esbuild';

// 编译主进程和 preload 脚本
const isWatch = process.argv.includes('--watch');

// 主进程用 CJS
const mainOptions = {
  entryPoints: ['electron/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outdir: 'dist/electron',
  outExtension: { '.js': '.cjs' }, // 输出为 .cjs
  external: ['electron', 'better-sqlite3'], // 原生模块不打包
  format: 'cjs',
  sourcemap: true,
};

// preload 用 CJS（Electron 的 preload 更兼容 CJS）
const preloadOptions = {
  entryPoints: ['electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outdir: 'dist/electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  format: 'cjs',
  sourcemap: true,
};

if (isWatch) {
  const mainCtx = await esbuild.context(mainOptions);
  const preloadCtx = await esbuild.context(preloadOptions);
  await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
  console.log('[esbuild] watching electron main/preload...');
} else {
  await Promise.all([esbuild.build(mainOptions), esbuild.build(preloadOptions)]);
  console.log('[esbuild] built electron main/preload');
}
