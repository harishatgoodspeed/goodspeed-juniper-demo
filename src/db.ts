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
    const applyOne = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
    });
    applyOne();
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
