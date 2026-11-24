-- Rollback: `0001_create_rooms.down.sql` drops all three tables -- safe only
-- because nothing has shipped against this schema yet (first migration).
-- Any later migration that alters these tables must document a real
-- recovery path instead, per migrations/README.md.
--
-- Room identity (`room_id`) and seed storage live on the Nextcloud app's own
-- `betteroffice_sessions` table (PLAN.md §10) -- the relay only needs the
-- opaque room id handed to it and the CRDT update stream for that room
-- (PLAN.md §13: "the relay only needs document-session metadata and the CRDT
-- update stream"). `epoch` and save-lease state are intentionally not
-- modelled here yet: nothing in Phase 3 bumps an epoch or grants a lease --
-- that lands with the conflict-recovery and save-coordination work in
-- Phase 5, alongside the logic that would actually use them.
CREATE TABLE rooms (
	room_id VARCHAR(64) NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'active',
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ordered CRDT update log (PLAN.md §8.4 "accepted update frames"). `id`'s
-- auto-increment order is the durable ordering -- a separate sequence
-- column would only duplicate it.
CREATE TABLE room_updates (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	room_id VARCHAR(64) NOT NULL,
	update_bytes LONGBLOB NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	KEY room_updates_room_id (room_id),
	CONSTRAINT room_updates_room_id_fk FOREIGN KEY (room_id) REFERENCES rooms (room_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One compacted checkpoint per room (PLAN.md §8.4 "checkpoint data"):
-- replacing `room_updates` for that room atomically, under one transaction,
-- the same shape as the Phase 0 PoC's file-backed log (`poc/relay/store.ts`).
CREATE TABLE room_checkpoints (
	room_id VARCHAR(64) NOT NULL,
	checkpoint_bytes LONGBLOB NOT NULL,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (room_id),
	CONSTRAINT room_checkpoints_room_id_fk FOREIGN KEY (room_id) REFERENCES rooms (room_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
