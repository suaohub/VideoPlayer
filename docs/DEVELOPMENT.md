# VideoPlayer 开发方案与进度

> 本文档面向接手开发者（尤其是从 Windows 拉取本仓库继续开发的场景）。包含技术选型、架构、当前进度、环境搭建、跨平台注意事项与待解问题。

## 一、技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 应用框架 | Electron | 复杂 UI（瀑布流、主题、键盘导航）用 Web 技术最快，且能嵌入 mpv |
| 前端 | React + TypeScript + Vite | 组件化，配合虚拟滚动处理海量列表 |
| 播放内核 | mpv（libmpv/FFmpeg） | 格式支持最全，硬解成熟，控件可完全自定义 |
| 缩略图/元数据 | FFmpeg（ffprobe + 抽帧） | 抽关键帧生成缩略图，读分辨率算宽高比 |
| 本地数据库 | SQLite（better-sqlite3） | 海量元数据的索引、过滤、去重必须落库 |
| 主进程构建 | esbuild | 快速把 TS 主进程/preload 打包为 CJS |

---

## 二、架构

```
Electron 主进程 (Node/CJS)
├─ 文件扫描服务 scanner.ts（递归遍历、目录树与标签入库）
├─ SQLite 数据层 db.ts + 查询层 queries.ts
├─ mpv 进程管理 main.ts（spawn mpv + JSON IPC over unix socket）
└─ IPC 网关（ipcMain.handle）──┐
                               │ contextBridge (preload.ts)
渲染进程 (React)               ┘
├─ 主页面 App.tsx：Toolbar / TagBar / FolderTree / VideoGrid
├─ 全局状态：过滤条件、焦点、主题、播放状态
└─ 全屏播放器容器（对接 mpv）
```

设计原则：重活（扫描、抽帧、解码）全在主进程/独立进程，渲染进程只管 UI。

### mpv 控制机制（已实现）

- 主进程 `spawn` mpv 子进程，带 `--input-ipc-server=<socket>` 开启 JSON IPC
- socket 按平台区分：Windows 用命名管道 `\\.\pipe\mpv-*`，其它平台用 `/tmp/mpv-socket-*`
- 主进程连上该 socket，发送命令（`cycle pause`、`seek`、`set_property volume/speed` 等）
- 通过 `observe_property` 订阅 `time-pos`/`duration`/`pause`/`volume`/`speed`，转发给渲染进程更新 UI（用户用 mpv 原生键位改音量/倍速时，DOM 控制栏也会同步）
- 通过 `keybind ENTER quit` 让 mpv 内按回车即退出；mpv 退出时主进程把 Electron 窗口拉回前台，实现「回车返回列表」

### 播放策略（重要变更）

早期方案是渲染进程用 HTML5 `<video>` 试播、失败再回退 mpv。因 Chromium 媒体栈解不了 HEVC / 10-bit / MKV / AVI 等（高码率片源常命中），该方案已废弃。

**现在统一走 mpv**（内置 FFmpeg，格式全）：
- `InternalPlayer.tsx` 挂载即调 `play-video`，mpv 原生窗口嵌入应用内容区
- 布局为「顶栏（DOM 48px）+ mpv 视频区 + 底部控制栏（DOM 64px）」三段，mpv 窗口几何避开上下两条 DOM 栏，规避 airspace 遮挡
- 底部控制栏是纯 React/CSS（吃主题变量），复用上面的 IPC 通道

### mpv 窗口嵌入（Windows）

当前用 `SetParent` + `SetWindowPos`（经 PowerShell 调 Win32 API）把独立 mpv 窗口塞进主窗口内容区，随窗口 move/resize 同步几何。可工作。
> 后续可选清理：改用 mpv 原生 `--wid=<HWND>` 直接嵌入，省掉每次 spawn PowerShell 的开销。

---

## 三、里程碑与进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 预研 | mpv 集成、IPC 控制、回车返回列表 | ✅ 完成 |
| M1 导入分类 | 数据层、扫描、扁平标签、目录树、过滤 UI | ✅ Windows 上 SQLite 已跑通 |
| M2 列表 | 缩略图生成（FFmpeg 抽帧）、瀑布流、横竖卡片 | ✅ 完成（虚拟滚动待补） |
| M3 播放器 | mpv 主力播放 + 底部控制栏（进度/音量/倍速） | 🚧 控制栏完成；三种全屏模式待做 |
| M4 交互 | 键盘方向导航 + 对角组合键、随机打乱/连播 | ✅ 空间导航 + 打乱完成（连播待补） |
| M5 打磨 | 悬浮预览、进度记忆、性能优化、异常处理、打包 | ⬜ 未开始 |

### M0 已完成细节

- Electron + Vite + React + esbuild 工程化
- mpv 播放 + IPC 控制：播放/暂停、seek、音量、倍速
- 回车关闭 mpv 并返回列表

### M1 已完成代码

- `db.ts`：SQLite 表结构（videos/folders/tags/video_tags/settings）
- `scanner.ts`：递归扫描、目录树与标签入库、导入进度回调
- `queries.ts`：视频列表过滤、标签、目录树、设置读写
- `main.ts`：`select-folders`/`import-folders`/`get-tags`/`get-folder-tree`/`get-videos`/`get-video-count`/`get-setting`/`set-setting` 等 IPC
- `preload.ts`：contextBridge 暴露上述 API
- UI：Toolbar / TagBar / FolderTree / VideoGrid + 三套主题

---

## 四、环境搭建

### 1. 安装依赖

```bash
npm install
```

### 2. native 模块编译（关键）

`better-sqlite3` 是原生模块，必须针对 **Electron 的 ABI** 从源码编译，否则运行时崩溃。

⚠️ **踩坑记录**：`better-sqlite3` v13 使用 prebuild 机制，普通的 `npm rebuild` / `electron-rebuild` **不会真正编译源码**——binding.gyp 里有条件 `force_build==1 or prebuild_exists==0`，当 `prebuilds/` 下存在预编译产物时会跳过编译，只 TOUCH stamp 文件。**必须显式传 `--force_build=1`**：

```bash
cd node_modules/better-sqlite3
npx node-gyp rebuild --force_build=1 \
  --runtime=electron --target=31.3.1 \
  --dist-url=https://electronjs.org/headers
```

（`--target` 对应 package.json 里的 electron 版本；Windows 无需 `--arch`，默认取本机架构。）

编译成功的标志是看到 `CXX(target) ... better_sqlite3.o` 与 `SOLINK_MODULE(target) ... better_sqlite3.node`，并且 `node_modules/better-sqlite3/build/Release/better_sqlite3.node` 存在（约 1.9MB）。

### 3. 启动开发

```bash
npm run dev
```

会并行启动 Vite（React 热重载）、esbuild watch（主进程编译）、Electron。

### 4. 构建生产版本

```bash
npm run build && npm start
```

---
## 五、平台与环境说明（Windows 为目标平台）

项目在 macOS 上起步，现已在 **Windows** 上跑通。以下为当前实现状态（旧的「macOS → Windows 必改项」多数已解决）。

### 1. mpv 二进制路径

已由 `main.ts` 的 `resolveMpvBin()` 处理：优先 `MPV_BIN` 环境变量 → Windows 默认 `C:\Program Files\MPV Player\mpv.exe` → PATH 里的 `mpv`。无需改代码，装在别处设环境变量即可。

### 2. mpv 窗口嵌入

Windows 上已实现嵌入：用 `SetParent` + `SetWindowPos`（PowerShell 调 Win32）把 mpv 窗口塞进主窗口内容区，随窗口变化同步几何。
- **airspace**：原生子窗口永远盖在 Chromium 内容之上，所以控制栏放在 mpv 视频区**外**（底部独立一栏），用 React/CSS 自绘。
- 后续可选：改用 mpv 原生 `--wid=<HWND>` 省掉 PowerShell 开销。
- macOS：NSView 跨进程无效，无法嵌入，只能独立窗口（原理限制，非 bug）。

### 3. socket 路径

已按平台处理：Windows 用命名管道 `\\.\pipe\mpv-*`，其它平台用 `/tmp/mpv-socket-*`。

### 4. native 模块

`better-sqlite3` 需针对 Electron ABI 编译（见第四节）。Windows 需要 Visual Studio Build Tools 提供 MSVC 与 `node-gyp` 依赖。**Windows 上已跑通**（早期 macOS 的 SIGSEGV 问题在 Windows 目标平台上不复现）。

---

## 六、已知遗留 / 待办

- **虚拟滚动**：当前瀑布流一次性渲染全部卡片，海量视频（数千）下需补虚拟滚动。
- **三种全屏模式**：目前是「嵌入应用内容区」一种，App 内全屏 / 窗口全屏 / 独立桌面全屏尚未实现。
- **控制栏焦点**：mpv 获焦时 DOM 控制栏鼠标点击的可靠性需实测（详见 M3）。
- **增量导入**：`scanner.ts` 按 path `INSERT OR IGNORE` 去重，能识别新增；文件被修改（mtime 变化）暂不更新。
- **macOS better-sqlite3 SIGSEGV**（历史记录，非当前阻塞）：如需回到 macOS 开发，可评估切 `node:sqlite`（Node 22+ 内置）或 `sql.js`（纯 wasm）规避原生编译。

---

## 七、下一步开发建议顺序

1. 实测嵌入播放 + 控制栏交互（点击、resize 对齐、焦点）
2. 三种全屏模式
3. 瀑布流虚拟滚动
4. 播放进度记忆、随机连播
5. M5 打磨与打包（electron-builder，已在 devDependencies）

