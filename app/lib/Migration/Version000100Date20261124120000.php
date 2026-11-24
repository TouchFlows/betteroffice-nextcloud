<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Schema\ColumnType;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * `betteroffice_sessions` (PLAN.md §10): the authoritative record of one
 * document's collaboration room -- room identity, its atomically-created
 * seed, the ETag it was generated from, and (once Phase 5 wires
 * DocumentService to maintain it) the last ETag the room is known to have
 * been saved at. `room_epoch` and active-save-lease state (also listed in
 * §10's suggested columns) are deliberately not added yet: nothing resets a
 * room's epoch or grants a lease until the conflict-recovery and
 * save-coordination work in Phase 5, which is what would actually consume
 * them.
 *
 * `seed` is nullable: the Nextcloud app cannot generate a CRDT seed itself
 * (that needs the BetterOffice WASM engine, which only runs in the
 * browser), so a session starts with no seed, and the first client to call
 * `POST /collab/session/{fileId}/seed` sets it -- atomically, the same
 * create-if-absent guarantee as the session row itself (§8.2 steps 4-6).
 */
class Version000100Date20261124120000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('betteroffice_sessions')) {
			return null;
		}

		$table = $schema->createTable('betteroffice_sessions');
		$table->addColumn('id', ColumnType::Bigint, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('instance_id', ColumnType::String, ['notnull' => true, 'length' => 64]);
		$table->addColumn('file_id', ColumnType::Bigint, ['notnull' => true]);
		$table->addColumn('format', ColumnType::String, ['notnull' => true, 'length' => 16]);
		$table->addColumn('room_id', ColumnType::String, ['notnull' => true, 'length' => 64]);
		$table->addColumn('initial_etag', ColumnType::String, ['notnull' => true, 'length' => 128]);
		$table->addColumn('saved_etag', ColumnType::String, ['notnull' => false, 'length' => 128]);
		// `length` pushed just past MySQL's MEDIUMBLOB ceiling (16,777,215
		// bytes) so Doctrine picks LONGBLOB -- a seed can approach the
		// relay's own 16 MiB max-frame budget (PLAN.md §8.4).
		$table->addColumn('seed', ColumnType::Blob, ['notnull' => false, 'length' => 16_777_216]);
		$table->addColumn('status', ColumnType::String, ['notnull' => true, 'length' => 16, 'default' => 'active']);
		$table->addColumn('created_at', ColumnType::DatetimeImmutable, ['notnull' => true]);
		$table->addColumn('updated_at', ColumnType::DatetimeImmutable, ['notnull' => true]);

		$table->setPrimaryKey(['id']);
		// The create-if-absent room init (§8.2) relies on this being unique:
		// the first writer's INSERT succeeds, every later one hits a
		// constraint violation and falls back to reading the existing row.
		$table->addUniqueConstraint(['instance_id', 'file_id', 'format'], 'bo_sessions_identity');
		$table->addUniqueConstraint(['room_id'], 'bo_sessions_room_id');

		return $schema;
	}
}
