import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config";

let instance: Database.Database | undefined;

function migrationsDir(): string {
  // dist/db.js -> ../migrations ; src/db.ts (via tsx) -> ../migrations
  return path.join(__dirname, "..", "migrations");
}

export function openDb(databasePath = config.DATABASE_PATH): Database.Database {
  // ":memory:" is used exclusively by .env.test (DATABASE_PATH=:memory:).
  // Caching it as the module-level singleton would mean every createApp()
  // call across every test in a file shares one database — a real bug that
  // surfaced as leftover 'queued' runs from one test tripping the "one
  // active run per owner" check in a later, unrelated test. A real file path
  // still benefits from the singleton (don't reopen the same file
  // repeatedly), but ":memory:" must always be a fresh, independent database.
  if (databasePath === ":memory:") {
    const db = new Database(databasePath);
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    return db;
  }

  if (instance) return instance;

  const dir = path.dirname(databasePath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  instance = db;
  return db;
}

export function runMigrations(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`
  );

  const dir = migrationsDir();
  if (!fs.existsSync(dir)) return;

  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((r) => r.id)
  );

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    // Table rebuilds (SQLite cannot ALTER a CHECK) drop tables that other
    // tables reference. That has to happen with foreign keys off, and the
    // pragma cannot be changed inside the transaction that applies the file.
    db.pragma("foreign_keys = OFF");
    try {
      const applyOne = db.transaction(() => {
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
      });
      applyOne();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}

/** For tests: open an isolated in-memory database with migrations applied. */
export function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = undefined;
}
