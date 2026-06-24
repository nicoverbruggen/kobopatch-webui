export default {
    name: '2026_06_24_000001_create_errors_table',
    up(db) {
        db.exec(
            `CREATE TABLE IF NOT EXISTS errors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                session_id TEXT,
                app_version TEXT,
                kind TEXT,
                message TEXT,
                stack TEXT,
                user_agent TEXT,
                flow_step TEXT
            )`,
        );
    },
};
