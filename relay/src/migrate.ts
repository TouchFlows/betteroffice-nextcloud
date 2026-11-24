import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb, { type Connection } from 'mariadb';
import { loadConfig } from './config.js';

/**
 * The relay's own migration system (PLAN.md §5.3), independent of the
 * Nextcloud app's (which uses OCP's migration mechanism — see
 * app/lib/Migration/). Forward migrations are plain numbered `.sql` files;
 * an optional sibling `<name>.down.sql` makes a migration revertible.
 * Applied migrations are tracked by filename and content checksum in
 * `schema_migrations`, so a changed already-applied file is caught instead
 * of silently ignored.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

interface MigrationFile {
	name: string;
	upPath: string;
	downPath: string | null;
}

function discoverMigrations(): MigrationFile[] {
	const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'));
	return files
		.sort()
		.map((name) => {
			const downPath = join(migrationsDir, name.replace(/\.sql$/, '.down.sql'));
			return {
				name,
				upPath: join(migrationsDir, name),
				downPath: existsSync(downPath) ? downPath : null,
			};
		});
}

function checksum(sql: string): string {
	return createHash('sha256').update(sql).digest('hex');
}

async function ensureMigrationsTable(conn: Connection): Promise<void> {
	await conn.query(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name VARCHAR(255) NOT NULL PRIMARY KEY,
			checksum CHAR(64) NOT NULL,
			applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`);
}

async function up(): Promise<void> {
	const config = loadConfig();
	// Migration files may contain more than one statement; this driver
	// otherwise only executes the first and silently ignores the rest.
	// Trusted input only (migration files on disk, not user data), and
	// scoped to this runner's own pool -- the server's runtime pool
	// (src/server.ts) must not enable this.
	const pool = mariadb.createPool({ ...config.database, multipleStatements: true });
	const conn = await pool.getConnection();
	try {
		await ensureMigrationsTable(conn);
		const applied = new Map<string, string>(
			(await conn.query('SELECT name, checksum FROM schema_migrations')).map(
				(row: { name: string; checksum: string }) => [row.name, row.checksum],
			),
		);

		for (const migration of discoverMigrations()) {
			const sql = readFileSync(migration.upPath, 'utf8');
			const sum = checksum(sql);
			const previous = applied.get(migration.name);
			if (previous === sum) continue;
			if (previous && previous !== sum) {
				throw new Error(
					`Migration ${migration.name} was already applied with a different checksum. ` +
						'Never edit an applied migration — add a new one instead.',
				);
			}

			console.log(`[migrate] applying ${migration.name}`);
			await conn.beginTransaction();
			try {
				await conn.query(sql);
				await conn.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [migration.name, sum]);
				await conn.commit();
			} catch (error) {
				await conn.rollback();
				throw new Error(`Migration ${migration.name} failed and was rolled back: ${(error as Error).message}`, {
					cause: error,
				});
			}
		}
	} finally {
		conn.release();
		await pool.end();
	}
}

async function down(): Promise<void> {
	const config = loadConfig();
	const pool = mariadb.createPool({ ...config.database, multipleStatements: true });
	const conn = await pool.getConnection();
	try {
		await ensureMigrationsTable(conn);
		const rows: Array<{ name: string }> = await conn.query(
			'SELECT name FROM schema_migrations ORDER BY applied_at DESC, name DESC LIMIT 1',
		);
		const last = rows[0];
		if (!last) {
			console.log('[migrate] nothing to roll back');
			return;
		}
		const migration = discoverMigrations().find((m) => m.name === last.name);
		if (!migration?.downPath) {
			throw new Error(`No ${last.name.replace(/\.sql$/, '.down.sql')} found — cannot roll back ${last.name}`);
		}

		console.log(`[migrate] rolling back ${migration.name}`);
		await conn.beginTransaction();
		try {
			await conn.query(readFileSync(migration.downPath, 'utf8'));
			await conn.query('DELETE FROM schema_migrations WHERE name = ?', [migration.name]);
			await conn.commit();
		} catch (error) {
			await conn.rollback();
			throw new Error(`Rollback of ${migration.name} failed: ${(error as Error).message}`, { cause: error });
		}
	} finally {
		conn.release();
		await pool.end();
	}
}

const command = process.argv[2] ?? 'up';
if (command === 'up') {
	await up();
} else if (command === 'down') {
	await down();
} else {
	console.error(`Unknown command "${command}". Usage: migrate.ts [up|down]`);
	process.exit(1);
}
