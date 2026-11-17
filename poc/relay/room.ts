import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as syncProtocol from 'y-protocols/sync.js';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { WebSocket } from 'ws';
import { RoomLog } from './store.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** Checkpoint after this many accepted updates, mirroring the reference relay's compaction trigger. */
const CHECKPOINT_EVERY = 20;

/**
 * One collaboration room: a Yjs doc fed by whatever CRDT updates the BetterOffice
 * client replicas emit (the relay never needs to know DOCX/XLSX/PPTX semantics,
 * only the generic Yjs update wire format they share), plus the peers connected
 * to it and a file-backed log standing in for durable storage.
 */
export class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  private readonly peers = new Set<WebSocket>();
  private readonly controlledIds = new Map<WebSocket, Set<number>>();
  private readonly log: RoomLog;
  private updatesSinceCheckpoint = 0;

  constructor(
    readonly id: string,
    dataDir: string,
  ) {
    this.log = new RoomLog(dataDir, id);
    this.rehydrate();

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.log.append(update);
      this.updatesSinceCheckpoint += 1;
      if (this.updatesSinceCheckpoint >= CHECKPOINT_EVERY) this.checkpoint();
      this.broadcastSyncUpdate(update, origin as WebSocket | null);
    });

    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: WebSocket | null) => {
      if (origin && this.peers.has(origin)) {
        let ids = this.controlledIds.get(origin);
        if (!ids) {
          ids = new Set();
          this.controlledIds.set(origin, ids);
        }
        for (const clientId of added) ids.add(clientId);
        for (const clientId of removed) ids.delete(clientId);
      }
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      const frame = encoding.toUint8Array(encoder);
      for (const peer of this.peers) if (peer !== origin) this.sendIfOpen(peer, frame);
    });
  }

  private rehydrate(): void {
    const frames = this.log.read();
    for (const frame of frames) Y.applyUpdate(this.doc, frame);
  }

  /** Merges the doc's full state into one checkpoint frame and replaces the log with it. */
  checkpoint(): void {
    this.log.compact(Y.encodeStateAsUpdate(this.doc));
    this.updatesSinceCheckpoint = 0;
  }

  join(socket: WebSocket): void {
    this.peers.add(socket);

    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, this.doc);
    this.sendIfOpen(socket, encoding.toUint8Array(syncEncoder));

    const stateEncoder = encoding.createEncoder();
    encoding.writeVarUint(stateEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep2(stateEncoder, this.doc);
    this.sendIfOpen(socket, encoding.toUint8Array(stateEncoder));

    const states = this.awareness.getStates();
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys())),
      );
      this.sendIfOpen(socket, encoding.toUint8Array(awarenessEncoder));
    }
  }

  receive(socket: WebSocket, message: Uint8Array): void {
    const decoder = decoding.createDecoder(message);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, socket);
        if (encoding.length(encoder) > 1) this.sendIfOpen(socket, encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, socket);
        break;
      }
      default:
        // Frame type the relay does not model (e.g. a host-specific extension).
        // Forward it untouched instead of dropping it, but never retain it.
        for (const peer of this.peers) if (peer !== socket) this.sendIfOpen(peer, message);
    }
  }

  leave(socket: WebSocket): void {
    this.peers.delete(socket);
    const ids = this.controlledIds.get(socket);
    this.controlledIds.delete(socket);
    if (ids && ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(ids), null);
    }
  }

  get peerCount(): number {
    return this.peers.size;
  }

  private broadcastSyncUpdate(update: Uint8Array, origin: WebSocket | null): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const peer of this.peers) if (peer !== origin) this.sendIfOpen(peer, frame);
  }

  private sendIfOpen(socket: WebSocket, data: Uint8Array): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(data);
  }
}
