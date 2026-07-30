import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';

// 视频记录类型
export interface VideoRecord {
  id: number;
  path: string;
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
}

// 文件夹记录类型（原始目录树）
export interface FolderRecord {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
  import_root_id: number | null;
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
      FOREIGN KEY (parent_id) REFERENCES folders(id)
    );
  `);

  // 视频表
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
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

  // 设置表（主题、全屏模式等偏好）
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // 索引：加速常用查询
  db.exec(`CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos(folder_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags(tag_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);`);

  console.log('[db] Initialized');
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}
