import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// 渲染进程（React）的 Vite 配置
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: '127.0.0.1', // 直接用 IP 避免 localhost 解析问题
  },
});
