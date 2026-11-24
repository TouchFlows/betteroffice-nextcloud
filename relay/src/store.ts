import type { Pool } from 'mariadb';

/**
 * MariaDB-backed persistence for one room (PLAN.md §8.4), replacing the
 * Phase 0 PoC's file-backed `RoomLog` (`poc/relay/store.ts`) with the real
 * schema from `migrations/0001_create_rooms.sql`. Same shape: an ordered
 * update log plus one compacted checkpoint, atomically replacing the log on
 * compaction -- here "atomic" means one transaction instead of the PoC's
 * rename().
 */
export class RoomStore {
	constructor(
		private readonly pool: Pool,
		readonly roomId: string,
	) {}

	/** Create-if-absent: idempotent so concurrent first-joiners don't race. */
	async ensureRoom(): Promise<void> {
		await this.pool.query('INSERT IGNORE INTO rooms (room_id) VALUES (?)', [this.roomId]);
	}

	/** Ordered frames: the checkpoint first (if any), then updates since it. */
	async readUpdates(): Promise<Uint8Array[]> {
		const conn = await this.pool.getConnection();
		try {
			const frames: Uint8Array[] = [];
			const checkpoints: Array<{ checkpoint_bytes: Buffer }> = await conn.query(
				'SELECT checkpoint_bytes FROM room_checkpoints WHERE room_id = ?',
				[this.roomId],
			);
			if (checkpoints[0]) frames.push(new Uint8Array(checkpoints[0].checkpoint_bytes));

			const updates: Array<{ update_bytes: Buffer }> = await conn.query(
				'SELECT update_bytes FROM room_updates WHERE room_id = ? ORDER BY id ASC',
				[this.roomId],
			);
			for (const row of updates) frames.push(new Uint8Array(row.update_bytes));
			return frames;
		} finally {
			conn.release();
		}
	}

	async appendUpdate(update: Uint8Array): Promise<void> {
		await this.pool.query('UPDATE rooms SET last_activity_at = CURRENT_TIMESTAMP WHERE room_id = ?', [this.roomId]);
		await this.pool.query('INSERT INTO room_updates (room_id, update_bytes) VALUES (?, ?)', [
			this.roomId,
			Buffer.from(update),
		]);
	}

	/** Atomically replaces the checkpoint and drops the update rows it now supersedes. */
	async checkpoint(checkpoint: Uint8Array): Promise<void> {
		const conn = await this.pool.getConnection();
		try {
			await conn.beginTransaction();
			await conn.query(
				'INSERT INTO room_checkpoints (room_id, checkpoint_bytes) VALUES (?, ?) ' +
					'ON DUPLICATE KEY UPDATE checkpoint_bytes = VALUES(checkpoint_bytes), updated_at = CURRENT_TIMESTAMP',
				[this.roomId, Buffer.from(checkpoint)],
			);
			await conn.query('DELETE FROM room_updates WHERE room_id = ?', [this.roomId]);
			await conn.commit();
		} catch (error) {
			await conn.rollback();
			throw error;
		} finally {
			conn.release();
		}
	}
}
