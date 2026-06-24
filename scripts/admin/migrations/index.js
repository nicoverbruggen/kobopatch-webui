import createErrorsTable from './2026_06_24_000001_create_errors_table.js';
import createIpBlacklistTable from './2026_06_24_000002_create_ip_blacklist_table.js';

export const ERROR_STORE_MIGRATIONS = [createErrorsTable, createIpBlacklistTable];

export function runErrorStoreMigrations(db) {
    db.exec(
        `CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            migration TEXT NOT NULL UNIQUE,
            batch INTEGER NOT NULL
        )`,
    );

    const applied = new Set(
        db
            .prepare('SELECT migration FROM migrations')
            .all()
            .map((row) => row.migration),
    );
    const pending = ERROR_STORE_MIGRATIONS.filter((migration) => !applied.has(migration.name));
    if (pending.length === 0) return;

    const current = db.prepare('SELECT COALESCE(MAX(batch), 0) AS batch FROM migrations').get().batch;
    const batch = current + 1;
    const markApplied = db.prepare('INSERT INTO migrations (migration, batch) VALUES (?, ?)');

    for (const migration of pending) {
        try {
            db.exec('BEGIN');
            migration.up(db);
            markApplied.run(migration.name, batch);
            db.exec('COMMIT');
        } catch (err) {
            try {
                db.exec('ROLLBACK');
            } catch {
                // Nothing to roll back; keep the original migration error.
            }
            throw err;
        }
    }
}
