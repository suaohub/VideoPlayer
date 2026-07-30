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
- 主进程连上该 socket，发送命令（`cycle pause`、`seek`、`set_property volume/speed` 等）
- 通过 `observe_property` 订阅 `time-pos`/`duration`/`pause`，转发给渲染进程更新 UI
- 通过 `keybind ENTER quit` 让 mpv 内按回车即退出；mpv 退出时主进程把 Electron 窗口拉回前台，实现「回车返回列表」

---

## 三、里程碑与进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 预研 | mpv 集成、IPC 控制、回车返回列表 | ✅ 完成 |
| M1 导入分类 | 数据层、扫描、扁平标签、目录树、过滤 UI | 🚧 代码完成，macOS 有 SIGSEGV 待解 |
| M2 列表 | 缩略图生成队列、瀑布流、虚拟滚动、横竖卡片 | ⬜ 未开始 |
| M3 播放器 | 全屏控件、三种全屏模式、进度/音量/倍速 UI | ⬜ 未开始 |
| M4 交互 | 键盘方向导航 + 对角组合键、随机打乱/连播 | ⬜ 未开始 |
| M5 打磨 | 悬浮预览、进度记忆、性能优化、异常处理、打包 | ⬜ 未开始 |

### M0 已完成细节

- Electron + Vite + React + esbuild 工程化
- mpv 独立窗口播放（macOS 上 `--wid` 无法真正嵌入，退化为独立窗口，见跨平台注意事项）
- IPC 控制：播放/暂停、seek、音量、倍速
- 回车关闭 mpv 并返回列表

### M1 已完成代码（待联调）

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
## 五、跨平台注意事项（macOS → Windows 必读）

本项目在 macOS 上起步，但**最终目标平台是 Windows**。以下是切到 Windows 时必须处理的点：

### 1. mpv 二进制路径（必改）

`electron/main.ts` 顶部：

```ts
const MPV_BIN = '/Users/mr.su/Downloads/mpv.app/Contents/MacOS/mpv';
```

Windows 上改成本机 `mpv.exe` 的绝对路径，例如：

```ts
const MPV_BIN = 'C:\\tools\\mpv\\mpv.exe';
```

> 建议后续重构为：优先读配置/环境变量，找不到再回退到内置路径。避免硬编码。

### 2. mpv 窗口嵌入（平台核心差异）

- **Windows**：窗口句柄 HWND 是系统内核对象，跨进程有效。mpv 子进程可用 `--wid=<HWND>` **真正嵌入** Electron 窗口。→ 「App 页面内全屏」「窗口桌面全屏」两种模式在 Windows 上可实现。
- **macOS**：NSView 是进程内内存指针，跨进程无效，独立 mpv 进程无法用 `--wid` 嵌入，只能弹独立窗口。这是原理限制，不是 bug。

`main.ts` 中已通过 `mainWindow.getNativeWindowHandle()` 读取句柄并传 `--wid`。在 Windows 上应能生效，需实测验证嵌入与 DOM 层级关系。

### 3. socket 路径

`main.ts` 里 IPC socket 用的是 `/tmp/mpv-socket-*`（unix domain socket）。**Windows 上 mpv 的 IPC 用命名管道**，需改为 `\\.\pipe\mpv-socket-xxx` 形式，并且 Node 端 `net.connect` 对命名管道的连接方式也要相应调整。这是 Windows 联调时的必改项。

### 4. native 模块

`better-sqlite3` 需在 Windows 上重新按第四节方式编译（Windows 需要 Visual Studio Build Tools 提供 MSVC 与 `node-gyp` 依赖）。

---

## 六、待解问题（当前阻塞）

### macOS 上 better-sqlite3 SIGSEGV

- **现象**：`app.whenReady` 中调用 `initDatabase()` 打开数据库时，Electron 进程 `SIGSEGV` 崩溃。数据库路径能打印出来，说明崩溃发生在 better-sqlite3 原生模块加载/调用瞬间。
- **已排除**：CPU 架构不匹配（已确认 `better_sqlite3.node`、Electron 二进制、系统、node 全部为 arm64）。
- **已做**：用 `--force_build=1` 成功从源码针对 Electron 31.3.1 编译出 `better_sqlite3.node`。
- **仍崩溃**，怀疑方向（供接手排查）：
  1. 编译时的 Node headers/NAPI 版本与运行时 Electron 的 V8/NAPI 不完全一致
  2. `better-sqlite3` v13 + Electron 31 的兼容性组合问题——可尝试降级 better-sqlite3 到与 Electron 31 已知兼容的版本，或升级 Electron
  3. 改用 `@electron/rebuild` 并确认它真正走了 `force_build`（本项目已装 `@electron/rebuild`）
  4. 备选：换 `node:sqlite`（Node 22+ 内置）或 `sql.js`（纯 wasm，无原生编译，跨平台零负担），规避原生模块编译问题
- **建议**：在 Windows 上继续时，优先在目标平台重新编译验证；若仍不稳定，认真评估切到 `sql.js` 或 `node:sqlite`，可彻底摆脱原生模块跨平台编译的麻烦。

---

## 七、下一步开发建议顺序

1. 在 Windows 上跑通环境（改 MPV_BIN、编译 better-sqlite3 或换 SQLite 方案）
2. 解决/绕过 SQLite 崩溃，联调 M1 导入→过滤全链路
3. 验证 Windows 上 `--wid` 真正嵌入，落地三种全屏模式（含 socket 改命名管道）
4. M2 缩略图生成队列 + 瀑布流虚拟滚动
5. M3 全屏播放器控件
6. M4 键盘空间导航（对角组合键）+ 随机播放
7. M5 打磨与打包（electron-builder，已在 devDependencies）

