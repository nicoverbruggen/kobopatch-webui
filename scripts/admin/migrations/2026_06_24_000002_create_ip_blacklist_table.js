export default {
    name: '2026_06_24_000002_create_ip_blacklist_table',
    up(db) {
        db.exec(
            `CREATE TABLE IF NOT EXISTS ip_blacklist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT NOT NULL UNIQUE,
                banned_at TEXT NOT NULL,
                reason TEXT,
                request_count INTEGER,
                window_seconds INTEGER
            )`,
        );
    },
};
