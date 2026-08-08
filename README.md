# VideoPlayer

基于 **Electron + React + mpv** 的本地媒体库，目标平台 **Windows**。以 mpv 为播放内核，具备强大解码能力，并在视频之外扩展为一站式本地媒体中心：**视频 / 音频 / 小说 / 漫画** 统一导入、智能分类、瀑布流浏览与键盘导航。

> 详细文档见 [`docs/PRODUCT.md`](docs/PRODUCT.md)（产品说明）与 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)（开发方案 + 当前进度 + 环境搭建）。

## 核心功能

- **多媒体类型**：顶部一键切换 全部 / 视频 / 音频 / 小说 / 漫画，各类型独立的目录树与计数。
- **视频播放**：所有视频统一走 mpv（内置 FFmpeg，高码率 / HEVC / 10-bit / MKV 等 Chromium 播不了的格式都能直接播），mpv 原生窗口嵌入应用内容区，底部为自绘 React 控制栏（播放 / 进度 / 音量 / 倍速）。
- **刷视频（Shorts）**：竖屏短视频流式浏览，上下滑动切换，浏览器可解码格式（mp4/webm/mov 等）走 HTML5 `<video>`。
- **音乐播放器**：音频文件（mp3/flac/wav/m4a/opus 等）进入专属播放页。
- **小说阅读器**：`.txt` 文本阅读，支持翻页 / 滚动两种模式、字号与行距调节、阅读进度记忆。**大部头小说采用分块（chunk）虚拟化渲染**，仅渲染当前块的段落，按块边界切换，避免整本书一次性进入 DOM 导致的加载慢与卡顿。
- **漫画阅读器**：图片文件夹作为一本漫画（库内 ext 记为 `.comic`），逐页浏览。
- **智能分类与检索**：按目录树多选过滤、搜索、收藏、按 添加时间 / 名称 / 大小 / 时长 / 修改时间 / 随机 排序。
- **标记删除与批量清理**：浏览或播放/阅读时按 `Delete` 将当前媒体标记为待删除，标记后从常规列表隐藏、进入专属「标记删除」管理页。管理页支持多选、全选、批量恢复、导出待删文件名列表（`.txt`），以及从磁盘彻底删除（含数据库记录、缩略图与孤儿标签清理，二次确认防误删）。目录树侧栏提供「收藏夹 / 标记删除」快捷入口并显示计数。
- **缩略图**：FFmpeg 抽帧生成，后台队列异步处理。
- **壁纸捕获**：播放中按 `Ctrl+Shift+B` 抓取当前 mpv 画面作为应用背景图（可调不透明度）。
- **主题**：8 套主题（白天 / 夜间 / 浪漫 / 海洋 / 森林 / 日落 / 石板 / 赛博朋克）。
- **可移动磁盘检测**：定期检测外接盘挂载状态，未挂载的来源目录会标记提示。

## 快捷键

| 按键 | 作用 |
|---|---|
| `Ctrl+Shift+B` | 播放视频时，抓取当前 mpv 画面设为应用背景壁纸（全局快捷键） |
| `B` | 「刷视频」浮层内抓取当前视频帧（仅在浮层内生效，不影响其他输入） |
| `Delete` | 将当前媒体标记为待删除。列表中焦点卡片、刷视频浮层、音乐播放器、小说 / 漫画阅读器内均可用 |

> 早期版本曾把壁纸捕获注册为单键 `B` 的全局快捷键，会在系统范围内劫持 `b` 的输入导致无法打字，现已改为组合键 `Ctrl+Shift+B`。

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
- **mpv 路径**：`electron/main.ts` 的 `resolveMpvBin()` 会优先读环境变量 `MPV_BIN`，再回退到默认安装路径 `C:\Program Files\MPV Player\mpv.exe`，都找不到再回退到 PATH 里的 `mpv`。装在别处时设 `MPV_BIN` 环境变量即可，无需改代码。
- **FFmpeg**：缩略图/元数据依赖 ffmpeg/ffprobe，可用 `FFMPEG_BIN` / `FFPROBE_BIN` 环境变量指定路径。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 针对 Electron ABI 重新编译 better-sqlite3（原生模块，必做）
#    见 docs/DEVELOPMENT.md「native 模块编译」一节
npm run rebuild:electron

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
│   ├── main.ts            # 主进程入口：窗口、mpv 进程与 IPC、全局快捷键、各类 IPC handler
│   ├── preload.ts         # 预加载脚本，contextBridge 暴露安全 API
│   ├── db.ts              # SQLite 初始化与表结构
│   ├── scanner.ts         # 文件夹递归扫描、目录树与媒体入库
│   ├── queries.ts         # 媒体/目录树查询、设置读写
│   ├── media.ts           # 媒体类型判定（视频/音频/文本/漫画）
│   ├── thumbnail.ts       # FFmpeg 抽帧缩略图
│   ├── thumbnailQueue.ts  # 缩略图后台生成队列
│   └── build.mjs          # esbuild 构建脚本（main/preload）
├── src/                   # React 渲染进程
│   ├── App.tsx            # 主界面（工具栏 + 目录树 + 媒体列表 + 各阅读/播放页路由）
│   ├── components/
│   │   ├── Toolbar.tsx       # 顶部工具栏（导入、媒体类型、排序、主题、搜索）
│   │   ├── FolderTree.tsx    # 目录树（按目录过滤）
│   │   ├── VideoGrid.tsx     # 瀑布流媒体列表
│   │   ├── SettingsModal.tsx # 设置面板（背景、透明度、缓存等）
│   │   ├── MusicPlayer.tsx   # 音乐播放页
│   │   ├── TextReader.tsx    # 小说阅读器（分块虚拟化渲染）
│   │   ├── ComicReader.tsx   # 漫画阅读器
│   │   ├── ShortsFeed.tsx    # 刷视频（竖屏短视频流）
│   │   └── MarkedForDeletionManager.tsx  # 标记删除管理页（多选恢复 / 导出 / 彻底删除）
│   ├── media.ts           # 前端媒体类型判定
│   ├── themes.css         # 8 套主题
│   ├── types.ts           # 共享类型定义
│   ├── api.ts             # 渲染进程 API 封装（含 mock）
│   ├── main.tsx           # React 入口
│   └── index.html         # HTML 模板
├── vite.config.ts
└── package.json
```

## 当前进度

- ✅ **M0** mpv 集成：IPC 控制（播放/暂停/进度/音量/倍速）+ 回车关闭返回列表
- ✅ **M1** 文件导入与分类：数据层、扫描、IPC、UI（Windows 上 SQLite 已跑通）
- ✅ **M2** 缩略图（FFmpeg 抽帧）与瀑布流布局
- ✅ **M3** 播放器：mpv 原生窗口嵌入 + 底部 React 控制栏
- ✅ **M4** 键盘空间导航（对角组合键）+ 随机打乱
- ✅ **M5** 多媒体扩展：音乐播放器、小说阅读器（分块虚拟化）、漫画阅读器、刷视频、壁纸捕获、多主题
- ✅ **M6** 标记删除工作流：`Delete` 标记、专属管理页、批量恢复 / 导出 / 磁盘彻底删除，侧栏收藏与标记快捷入口
- 🚧 **M7** 打磨与打包

## 构建生产版本

```bash
# 编译前端 + 主进程
npm run build
npm start

# 打包 Windows 安装包（NSIS，x64）→ 输出到 release/
npm run dist
```
