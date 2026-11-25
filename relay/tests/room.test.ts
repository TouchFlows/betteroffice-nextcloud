import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync.js';
import type { WebSocket } from 'ws';
import { Room, type RoomParticipant } from '../src/room.js';
import type { RoomStore } from '../src/store.js';

const MESSAGE_SYNC = 0;

const WRITER: RoomParticipant = { userId: 'alice', name: 'Alice', avatar: null, role: 'write' };

/** Enough of `ws`'s `WebSocket` for `Room` to drive: readyState + send() + close(). */
class FakeSocket {
	readonly OPEN = 1;
	readyState = 1;
	readonly sent: Uint8Array[] = [];
	closed: { code: number; reason: string } | null = null;

	send(data: Uint8Array): void {
		this.sent.push(data);
	}

	close(code: number, reason: string): void {
		this.readyState = 3;
		this.closed = { code, reason };
	}
}

/** In-memory double for `RoomStore` -- `Room`'s own ordering/durability logic is the thing under test, not SQL. */
class FakeStore {
	readonly updates: Uint8Array[] = [];
	checkpointed: Uint8Array | null = null;
	failAppend = false;

	async ensureRoom(): Promise<void> {}

	async readUpdates(): Promise<Uint8Array[]> {
		return this.checkpointed ? [this.checkpointed, ...this.updates] : [...this.updates];
	}

	async appendUpdate(update: Uint8Array): Promise<void> {
		if (this.failAppend) throw new Error('simulated persistence failure');
		this.updates.push(update);
	}

	async checkpoint(bytes: Uint8Array): Promise<void> {
		this.checkpointed = bytes;
		this.updates.length = 0;
	}
}

function syncUpdateFrame(update: Uint8Array): Uint8Array {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, MESSAGE_SYNC);
	syncProtocol.writeUpdate(encoder, update);
	return encoding.toUint8Array(encoder);
}

/** Lets the queued persist-then-broadcast microtask chain (`Room`'s `persistQueue`) settle. */
async function flush(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

test('a room rehydrates its Y.Doc from whatever the store already has', async () => {
	const store = new FakeStore();
	const seedDoc = new Y.Doc();
	seedDoc.getText('body').insert(0, 'hello');
	store.updates.push(Y.encodeStateAsUpdate(seedDoc));

	const room = await Room.create('room-1', store as unknown as RoomStore);
	try {
		assert.equal(room.doc.getText('body').toString(), 'hello');
	} finally {
		room.destroy();
	}
});

test('an update is persisted before it is broadcast, and never echoed back to its origin', async () => {
	const store = new FakeStore();
	const room = await Room.create('room-2', store as unknown as RoomStore);
	try {
		const sender = new FakeSocket();
		const other = new FakeSocket();
		room.join(sender as unknown as WebSocket, WRITER);
		room.join(other as unknown as WebSocket, { ...WRITER, userId: 'bob', name: 'Bob' });
		sender.sent.length = 0;
		other.sent.length = 0;

		const senderDoc = new Y.Doc();
		senderDoc.getText('body').insert(0, 'x');
		room.receive(sender as unknown as WebSocket, syncUpdateFrame(Y.encodeStateAsUpdate(senderDoc)));
		await flush();

		assert.equal(store.updates.length, 1, 'the update must be durably stored');
		assert.equal(other.sent.length, 1, 'the other peer must receive the broadcast only after persistence');
		assert.equal(sender.sent.length, 0, 'the originating peer is not echoed its own update');
	} finally {
		room.destroy();
	}
});

test('a persistence failure closes every connection instead of broadcasting an unpersisted update', async () => {
	const store = new FakeStore();
	store.failAppend = true;
	const room = await Room.create('room-3', store as unknown as RoomStore);
	try {
		const a = new FakeSocket();
		room.join(a as unknown as WebSocket, WRITER);

		room.doc.getText('body').insert(0, 'x');
		await flush();

		assert.ok(room.isFailed);
		assert.ok(a.closed, 'the peer must be disconnected rather than left trusting an unpersisted state');
	} finally {
		room.destroy();
	}
});

test('join sends sync step 1, sync step 2, and the room\'s own (initially empty) awareness state', async () => {
	const store = new FakeStore();
	const room = await Room.create('room-4', store as unknown as RoomStore);
	try {
		const a = new FakeSocket();
		room.join(a as unknown as WebSocket, WRITER);
		// y-protocols' Awareness constructor calls setLocalState({}) on
		// itself, so a brand new room already has one awareness entry --
		// join() always sends 3 frames, not 2, even before any real peer
		// presence exists.
		assert.equal(a.sent.length, 3);
	} finally {
		room.destroy();
	}
});

test('join records the participant identity, and leave forgets it', async () => {
	const store = new FakeStore();
	const room = await Room.create('room-participants', store as unknown as RoomStore);
	try {
		const a = new FakeSocket();
		const b = new FakeSocket();
		room.join(a as unknown as WebSocket, WRITER);
		room.join(b as unknown as WebSocket, {
			userId: 'bob',
			name: 'Bob',
			avatar: 'https://cloud.example.test/index.php/avatar/bob/64',
			role: 'read',
		});

		assert.deepEqual(
			room.connectedParticipants.map((participant) => [participant.name, participant.role]).sort(),
			[['Alice', 'write'], ['Bob', 'read']],
		);

		room.leave(b as unknown as WebSocket);
		assert.deepEqual(room.connectedParticipants.map((participant) => participant.name), ['Alice']);
	} finally {
		room.destroy();
	}
});

test('leave removes the peer and reports the room as empty', async () => {
	const store = new FakeStore();
	const room = await Room.create('room-5', store as unknown as RoomStore);
	try {
		const a = new FakeSocket();
		room.join(a as unknown as WebSocket, WRITER);
		assert.equal(room.isEmpty, false);
		room.leave(a as unknown as WebSocket);
		assert.equal(room.isEmpty, true);
	} finally {
		room.destroy();
	}
});

test('receive() applies an incoming sync update from one peer and persists it', async () => {
	const store = new FakeStore();
	const room = await Room.create('room-6', store as unknown as RoomStore);
	try {
		const sender = new FakeSocket();
		const other = new FakeSocket();
		room.join(sender as unknown as WebSocket, WRITER);
		room.join(other as unknown as WebSocket, { ...WRITER, userId: 'bob', name: 'Bob' });
		other.sent.length = 0;

		const senderDoc = new Y.Doc();
		senderDoc.getText('body').insert(0, 'hi');
		const update = Y.encodeStateAsUpdate(senderDoc);

		room.receive(sender as unknown as WebSocket, syncUpdateFrame(update));
		await flush();

		assert.equal(room.doc.getText('body').toString(), 'hi');
		assert.equal(store.updates.length, 1);
	} finally {
		room.destroy();
	}
});
