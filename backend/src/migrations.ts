import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SqlJsDatabase } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// في الوضعين (tsx من src، والتشغيل من dist) المجلد يقع دائماً بمستوى واحد فوق الكود المصدَّر:
//   dev  : backend/src/migrations.ts → backend/migrations
//   prod : backend/dist/migrations.js → backend/migrations
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || path.join(__dirname, '..', 'migrations');

export { MIGRATIONS_DIR };

function hasApplied(db: SqlJsDatabase, name: string): boolean {
  try {
    const stmt = db.prepare('SELECT name FROM schema_migrations WHERE name = ?');
    stmt.bind([name]);
    const found = stmt.step();
    stmt.free();
    return found;
  } catch { return false; }
}

function markApplied(db: SqlJsDatabase, name: string) {
  db.run('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
}

export interface MigrationResult {
  applied: string[];
  pendingCount: number;
}

// تطبيق كل ملفات migrations/ المرقّمة غير المطبّقة بعد. كل ملف داخل معاملة مستقلة:
// النجاح = COMMIT + تسجيل في schema_migrations، الفشل = ROLLBACK (لا تأثير جزئي) + إرسال خطأ واضح.
export function runMigrations(db: SqlJsDatabase): MigrationResult {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      appliedAt TEXT DEFAULT (datetime('now')),
      checksum TEXT DEFAULT ''
    )
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return { applied: [], pendingCount: 0 };
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    if (hasApplied(db, file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.run('BEGIN');
    try {
      db.exec(sql);
      markApplied(db, file);
      db.run('COMMIT');
      applied.push(file);
    } catch (e) {
      try { db.run('ROLLBACK'); } catch { /* لا معاملة مفتوحة */ }
      throw new Error(`Migration failed (${file}): ${(e as Error).message}`);
    }
  }
  return { applied, pendingCount: files.length - applied.length };
}