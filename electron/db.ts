import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';

// 视频记录类型
export interface VideoRecord {
  id: number;
  path: string;
  source_path: string | null;
  name: string;
  ext: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  aspect_ratio: number | null;
  thumbnail_path: string | null;
  folder_id: number | null;
  added_at: number;
  mtime: number;
  favorited: number;
  marked_for_deletion: number;
  marked_for_deletion_at: number | null;
}

// 文件夹记录类型（原始目录树）
export interface FolderRecord {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
  import_root_id: number | null;
  hidden: number;
}

let db: Database.Database;

// 初始化数据库
export function initDatabase() {
  const dbPath = join(app.getPath('userData'), 'videoplayer.db');
  console.log('[db] Database path:', dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // 提升并发写入性能

  // 文件夹表：保存原始目录树结构
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      parent_id INTEGER,
      import_root_id INTEGER,
      hidden INTEGER DEFAULT 0,
      locked INTEGER DEFAULT 0,
      FOREIGN KEY (parent_id) REFERENCES folders(id)
    );
  `);

  // 视频表
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      source_path TEXT,
      name TEXT NOT NULL,
      ext TEXT,
      size INTEGER,
      duration REAL,
      width INTEGER,
      height INTEGER,
      aspect_ratio REAL,
      thumbnail_path TEXT,
      folder_id INTEGER,
      added_at INTEGER,
      mtime INTEGER,
      favorited INTEGER DEFAULT 0,
      marked_for_deletion INTEGER DEFAULT 0,
      marked_for_deletion_at INTEGER,
      FOREIGN KEY (folder_id) REFERENCES folders(id)
    );
  `);

  // 标签表（扁平化子文件夹名）
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
  `);

  // 视频-标签多对多关系
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_tags (
      video_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (video_id, tag_id),
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

  // 独立保存隐藏目录路径，避免目录记录刷新或重建后丢失隐藏状态。
  db.exec(`
    CREATE TABLE IF NOT EXISTS hidden_folder_paths (
      path TEXT PRIMARY KEY COLLATE NOCASE NOT NULL,
      hidden_at INTEGER NOT NULL
    );
  `);

  // 整理分类：每个视频最多关联一个分类，和扫描得到的原始标签分开保存。
  db.exec(`
    CREATE TABLE IF NOT EXISTS organize_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS video_organize_categories (
      video_id INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES organize_categories(id) ON DELETE CASCADE
    );
  `);

  // 设置表（主题、全屏模式等偏好）
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // 播放历史与断点：路径作为键，避免视频记录重建后丢失播放位置。
  // 该表故意不直接依赖 videos 外键：移动磁盘/重新扫描期间仍可保留最近播放路径，
  // 重新导入同一路径后即可继续使用断点。
  db.exec(`
    CREATE TABLE IF NOT EXISTS playback_history (
      path TEXT PRIMARY KEY COLLATE NOCASE,
      position REAL NOT NULL DEFAULT 0,
      duration REAL,
      last_played_at INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0
    );
  `);

  // 迁移：为旧数据库添加目录隐藏状态。
  const folderColumns = db.pragma('table_info(folders)') as Array<{ name: string }>;
  if (!folderColumns.some(c => c.name === 'hidden')) {
    db.exec(`ALTER TABLE folders ADD COLUMN hidden INTEGER DEFAULT 0;`);
    console.log('[db] Migration: added folder hidden column');
  }
  if (!folderColumns.some(c => c.name === 'locked')) {
    db.exec(`ALTER TABLE folders ADD COLUMN locked INTEGER DEFAULT 0;`);
    console.log('[db] Migration: added folder locked column');
  }
  // 迁移：为整理分类添加启用状态。停用只影响新的分类操作，历史标记仍然保留。
  const organizeCategoryColumns = db.pragma('table_info(organize_categories)') as Array<{ name: string }>;
  if (!organizeCategoryColumns.some(c => c.name === 'enabled')) {
    db.exec(`ALTER TABLE organize_categories ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;`);
    console.log('[db] Migration: added organize category enabled column');
  }
  db.exec(`
    INSERT OR IGNORE INTO hidden_folder_paths (path, hidden_at)
    SELECT path, strftime('%s', 'now') * 1000
    FROM folders
    WHERE hidden = 1;
  `);

  // 索引：加速常用查询
  db.exec(`CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos(folder_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags(tag_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_video_organize_category ON video_organize_categories(category_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_playback_history_last_played ON playback_history(last_played_at DESC);`);

  // 迁移：为旧数据库添加 favorited 字段
  const columns = db.pragma('table_info(videos)') as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'source_path')) {
    db.exec(`ALTER TABLE videos ADD COLUMN source_path TEXT;`);
    db.exec(`UPDATE videos SET source_path = path WHERE source_path IS NULL;`);
    console.log('[db] Migration: added source_path column');
  }
  if (!columns.some(c => c.name === 'favorited')) {
    db.exec(`ALTER TABLE videos ADD COLUMN favorited INTEGER DEFAULT 0;`);
    console.log('[db] Migration: added favorited column');
  }

  // 迁移：为旧数据库添加 marked_for_deletion 字段
  if (!columns.some(c => c.name === 'marked_for_deletion')) {
    db.exec(`ALTER TABLE videos ADD COLUMN marked_for_deletion INTEGER DEFAULT 0;`);
    console.log('[db] Migration: added marked_for_deletion column');
  }
  if (!columns.some(c => c.name === 'marked_for_deletion_at')) {
    db.exec(`ALTER TABLE videos ADD COLUMN marked_for_deletion_at INTEGER;`);
    console.log('[db] Migration: added marked_for_deletion_at column');
  }
  // 旧版本只保存了删除标记，没有标记时间；用导入时间作为兼容排序依据，
  // 新的标记会在 toggleMarkedForDeletion 中写入精确时间戳。
  db.exec(`
    UPDATE videos
    SET marked_for_deletion_at = added_at
    WHERE marked_for_deletion = 1 AND marked_for_deletion_at IS NULL;
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_videos_marked_for_deletion_at
    ON videos(marked_for_deletion, marked_for_deletion_at DESC);`);

  console.log('[db] Initialized');
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}
