const Database = require('better-sqlite3');

const dbPath = process.env.MEDIANEST_DB || process.env.VIDEOPLAYER_DB || `${process.env.APPDATA}\\videoplayer\\videoplayer.db`;
if (!dbPath) throw new Error('database path required');

try {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const prefix = 'F:\\v2\\91';

  console.log(`DATABASE=${dbPath}`);
  console.log(`JOURNAL_MODE=${JSON.stringify(db.pragma('journal_mode'))}`);
  console.log(`INTEGRITY=${JSON.stringify(db.pragma('integrity_check'))}`);

  function print(title, sql, params = []) {
    console.log(`\n=== ${title} ===`);
    const rows = db.prepare(sql).all(...params);
    for (const row of rows) console.log(JSON.stringify(row));
    console.log(`COUNT=${rows.length}`);
  }

  print(
    'folders',
    `SELECT id, path, name, parent_id, import_root_id, hidden
     FROM folders
     WHERE path = ? OR path LIKE ?
     ORDER BY path COLLATE NOCASE`,
    [prefix, `${prefix}\\%`],
  );

  print(
    'videos',
    `SELECT id, path, name, ext, size, folder_id, added_at, mtime,
            favorited, marked_for_deletion, thumbnail_path
     FROM videos
     WHERE path = ? OR path LIKE ?
     ORDER BY path COLLATE NOCASE`,
    [prefix, `${prefix}\\%`],
  );

  print(
    'hidden_folder_paths',
    `SELECT path, hidden_at
     FROM hidden_folder_paths
     WHERE path = ? OR path LIKE ?
     ORDER BY path COLLATE NOCASE`,
    [prefix, `${prefix}\\%`],
  );

  print(
    'organize_categories',
    `SELECT v.id AS video_id, v.path, voc.category_id, c.name AS category_name
     FROM videos v
     LEFT JOIN video_organize_categories voc ON voc.video_id = v.id
     LEFT JOIN organize_categories c ON c.id = voc.category_id
     WHERE v.path = ? OR v.path LIKE ?
     ORDER BY v.path COLLATE NOCASE`,
    [prefix, `${prefix}\\%`],
  );

  print(
    'all_matching_names',
    `SELECT id, path, name, ext, size, folder_id
     FROM videos
     WHERE name LIKE ? OR path LIKE ?
     ORDER BY path COLLATE NOCASE`,
    ['%4929375201600210288%', '%4929375201600210288%'],
  );

  db.close();
} catch (error) {
  console.error(`DATABASE_READ_FAILED=${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
}
