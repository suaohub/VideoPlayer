# MediaNest v1.3.0 更新日志

## 🎯 核心功能

### 1. 目录隐藏功能
- **隐藏目录及子目录**：右键目录树中的任意目录，选择"隐藏目录及子目录"，该目录及其所有子目录将从界面隐藏
- **持久化隐藏状态**：使用 `hidden_folder_paths` 表记录隐藏路径，即使删除后重新导入也能保持隐藏状态
- **递归隐藏逻辑**：使用 CTE 递归查询，自动隐藏所有子目录
- **恢复显示**：在设置面板的"隐藏目录"区域查看所有已隐藏目录，点击眼睛图标恢复显示
- **全局过滤**：所有查询（视频列表、统计、标签计数、分类计数）自动过滤隐藏目录中的文件

**使用场景**：
- 临时排除某些不想看到的内容（如工作文件、旧备份）
- 保留导入记录、收藏和分类，但不在日常浏览中显示

### 2. 批量整理增强
- **多目录整理**：支持在目录树中多选目录（Ctrl/Shift点击），一次性整理多个目录
- **智能去重**：自动过滤父子目录重复（父目录已选时，子目录无需重复处理）
- **两种整理模式**：
  - **分散整理**（默认）：每个选中目录各自建立分类文件夹
  - **集中整理**：设置统一输出目录，所有文件按分类集中到该目录
- **父子路径判断**：使用 `path.relative` 和 `path.resolve` 精确判断路径包含关系

### 3. 批量分类功能
- **批量设置分类**：在视频列表顶部点击"批量整理"，选中多个文件后，使用下拉框统一设置分类
- **分批处理**：`batchSetVideoOrganizeCategory` 自动分批处理（每批500个），避免 SQLite 变量上限（999）
- **UI整合**：批量操作工具栏同时支持收藏管理和整理管理两种场景
- **选择状态清理**：文件离开当前筛选结果后，自动清除残留选择状态

### 4. 代码架构优化
- **usePreferences Hook**：将用户偏好管理逻辑从 App.tsx 抽出，职责更清晰
  - 主题、卡片大小、排序、壁纸、工具栏透明度/模糊
  - 整理输出目录
  - 所有设置自动持久化到 SQLite
- **类型增强**：
  - `Folder` 接口新增 `hidden` 字段
  - `ElectronAPI` 新增 `getHiddenFolders`、`setFolderHidden`、`batchSetVideoOrganizeCategory`、`organizeFolders` 方法
- **样式优化**：
  - 新增隐藏目录列表样式
  - 移除工具栏多余阴影
  - 优化设置面板布局

## 📊 数据库变更

### 新增表
```sql
CREATE TABLE IF NOT EXISTS hidden_folder_paths (
  path TEXT PRIMARY KEY COLLATE NOCASE NOT NULL,
  hidden_at INTEGER NOT NULL
);
```

### 表结构变更
```sql
-- folders 表新增 hidden 字段
ALTER TABLE folders ADD COLUMN hidden INTEGER DEFAULT 0;
```

### 迁移逻辑
- 启动时自动检测并添加 `hidden` 字段
- 将已标记隐藏的目录同步到 `hidden_folder_paths` 表

## 🔧 API 变更

### 新增 IPC Handler
- `get-hidden-folders`：获取所有显式隐藏的目录
- `set-folder-hidden`：设置目录隐藏状态
- `batch-set-video-organize-category`：批量设置视频分类
- `organize-folders`：批量整理多个目录（替代 `organize-folder`）

### 修改的函数
- `getFolderTree`：过滤隐藏目录
- `getVideos`：过滤隐藏目录中的文件
- `getVideoCount`：统计时排除隐藏目录
- `getAllTags`：标签计数排除隐藏目录
- `getOrganizeCategories`：分类计数排除隐藏目录
- `getFavoritedCount`：收藏计数排除隐藏目录
- `getMarkedForDeletionCount`：待删除计数排除隐藏目录
- `deleteFolderCascade`：删除目录时同时清理隐藏记录
- `ensureFolder`：扫描器创建/更新目录时恢复隐藏状态
- `cleanupEmptyFolders`：清理空目录时同时清理隐藏记录

## 🎨 UI/UX 改进

### 目录树
- 右键菜单新增"隐藏目录及子目录"选项
- 菜单高度调整为 222px（新增一项）

### 视频列表
- 批量操作工具栏显示条件：`showFavorited || onBatchSetOrganizeCategory`
- 新增批量分类下拉框（仅在整理场景显示）
- 按钮文字：收藏场景显示"批量管理"，整理场景显示"批量整理"

### 设置面板
- 新增"隐藏目录"区域
- 显示所有已隐藏目录的名称和路径
- 每个隐藏目录带有恢复按钮（眼睛图标）
- 整理说明文字更新："请先在目录树中选择一个或多个目录"
- 整理按钮文字："开始整理所选目录"
- 已选目录提示：单选显示名称，多选显示"N 个目录"

## 🐛 修复

- 修复目录重新导入后隐藏状态丢失的问题
- 修复批量操作选中不可见文件的问题
- 修复未使用的 import 警告（ComicReader.tsx）
- 修复 ReactElement 类型警告（TextReader.tsx）
- 修复 Mock 数据缺少必需字段的问题

## 📝 技术细节

### 隐藏目录查询性能
使用 CTE（Common Table Expression）递归查询：
```sql
WITH RECURSIVE hidden_folders(id) AS (
  SELECT f.id
  FROM folders f
  LEFT JOIN hidden_folder_paths h ON h.path = f.path
  WHERE f.hidden = 1 OR h.path IS NOT NULL
  UNION ALL
  SELECT child.id
  FROM folders child
  JOIN hidden_folders parent ON child.parent_id = parent.id
)
```

### 批量操作分批策略
```typescript
// categoryId 为 null 时删除分类，分批处理避免 SQLite 999 变量限制
if (categoryId == null) {
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const placeholders = batch.map(() => '?').join(',');
    db.prepare(`DELETE FROM video_organize_categories WHERE video_id IN (${placeholders})`).run(...batch);
  }
}
```

### 父子目录判断
```typescript
function isPathWithin(childPath: string, parentPath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath === ''
    || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}
```

## 🚀 升级指南

### 从 v1.2.0 升级
1. 自动迁移数据库（添加 `hidden` 字段和 `hidden_folder_paths` 表）
2. 无需手动操作，启动即可使用新功能
3. 旧版本的整理操作需改为在目录树中选择目录后，在设置面板点击"开始整理所选目录"

## 📈 统计

- **修改文件**：16 个
- **新增代码**：534 行
- **删除代码**：96 行
- **新增文件**：3 个（`usePreferences.ts`、`global.d.ts`、数据库快照）
- **新增 IPC Handler**：4 个
- **新增数据库表**：1 个
- **新增字段**：1 个

## 🎯 下一步计划（M7）

- [ ] 性能优化：大型媒体库（10000+ 文件）加载速度
- [ ] 错误处理增强：文件移动失败的详细提示
- [ ] 整理预览：整理前显示将要移动的文件列表
- [ ] 批量操作进度：显示批量操作的实时进度
- [ ] Windows 安装包测试与优化
