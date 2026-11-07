import { openDb } from "./db";

const db = openDb();
const count = db.prepare("SELECT count(*) as n FROM schema_migrations").get() as { n: number };
console.log(`Migrations applied. ${count.n} migration(s) recorded.`);
db.close();
