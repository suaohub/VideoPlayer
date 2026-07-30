# VideoPlayer

基于 **Electron + React + mpv** 的本地视频播放器，目标平台 **Windows**，具备强大解码能力，支持海量本地视频导入、智能分类、瀑布流浏览与键盘导航。

> 详细文档见 [`docs/PRODUCT.md`](docs/PRODUCT.md)（产品说明）与 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)（开发方案 + 当前进度 + 环境搭建）。

## 技术栈

| 层 | 选型 |
|---|---|
| 应用框架 | Electron |
| 前端 | React + TypeScript + Vite |
| 播放内核 | mpv（libmpv/FFmpeg，通过 IPC 控制） |
| 本地数据库 | SQLite（better-sqlite3） |
| 主进程构建 | esbuild |

## 前置依赖

- Node.js 18+
- **mpv 播放器**
  - Windows：下载 mpv，记下 `mpv.exe` 路径
  - macOS：`brew install mpv`
- **重要**：`electron/main.ts` 顶部的 `MPV_BIN` 常量目前硬编码为 macOS 路径，**在 Windows 上必须改成本机 `mpv.exe` 的绝对路径**（详见开发文档「跨平台注意事项」）。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 针对 Electron ABI 重新编译 better-sqlite3（原生模块，必做）
#    见 docs/DEVELOPMENT.md「native 模块编译」一节
npx node-gyp rebuild --force_build=1 --runtime=electron --target=31.3.1 \
  --dist-url=https://electronjs.org/headers \
  --directory node_modules/better-sqlite3

# 3. 启动开发环境（Vite + esbuild watch + Electron）
npm run dev
```

## 项目结构

```
VideoPlayer/
├── docs/
│   ├── PRODUCT.md         # 产品说明书
│   └── DEVELOPMENT.md     # 开发方案 / 进度 / 环境搭建
├── electron/              # Electron 主进程（TypeScript，esbuild 打包为 .cjs）
│   ├── main.ts            # 主进程入口：窗口、mpv 进程与 IPC、各类 IPC handler
│   ├── preload.ts         # 预加载脚本，contextBridge 暴露安全 API
│   ├── db.ts              # SQLite 初始化与表结构
│   ├── scanner.ts         # 文件夹递归扫描、目录树与标签入库
│   ├── queries.ts         # 视频/标签/目录树查询、设置读写
│   └── build.mjs          # esbuild 构建脚本（main/preload）
├── src/                   # React 渲染进程
│   ├── App.tsx            # 主界面（工具栏 + 标签栏 + 目录树 + 视频列表）
│   ├── components/
│   │   ├── Toolbar.tsx    # 顶部工具栏（导入、随机、主题、全屏模式）
│   │   ├── TagBar.tsx     # 扁平化标签栏（多选过滤）
│   │   ├── FolderTree.tsx # 原始目录树（按目录过滤）
│   │   └── VideoGrid.tsx  # 瀑布流视频列表
│   ├── themes.css         # 三套主题（白天 / 夜间 / 浪漫情趣风）
│   ├── types.ts           # 共享类型定义
│   ├── main.tsx           # React 入口
│   └── index.html         # HTML 模板
├── vite.config.ts
└── package.json
```

## 当前进度

- ✅ **M0** mpv 集成：独立窗口播放 + IPC 控制（播放/暂停/进度/音量/倍速）+ 回车关闭返回列表
- 🚧 **M1** 文件导入与分类：数据层、扫描、IPC、UI 已完成；**macOS 上 better-sqlite3 存在 SIGSEGV 待解**（见开发文档）
- ⬜ M2 缩略图与瀑布流虚拟滚动
- ⬜ M3 全屏播放器控件与三种全屏模式
- ⬜ M4 键盘空间导航（对角组合键）+ 随机播放
- ⬜ M5 打磨与打包

## 构建生产版本

```bash
npm run build
npm start
```
