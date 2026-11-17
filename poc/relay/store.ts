import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * File-backed append log standing in for the MariaDB-backed persistence Phase 3
 * will build. Proves the restart-recovery shape (checkpoint + update log,
 * atomic replace on compaction) without standing up a database for a PoC.
 */
export class RoomLog {
  private readonly path: string;

  constructor(dataDir: string, roomId: string) {
    const digest = createHash('sha256').update(roomId).digest('hex');
    this.path = join(dataDir, `${digest}.log`);
    mkdirSync(dirname(this.path), { recursive: true });
  }

  /** Ordered frames: a lone checkpoint frame first (if any), then update frames. */
  read(): Uint8Array[] {
    if (!existsSync(this.path)) return [];
    const buffer = readFileSync(this.path);
    const frames: Uint8Array[] = [];
    let offset = 0;
    while (offset < buffer.byteLength) {
      const length = buffer.readUInt32LE(offset);
      offset += 4;
      frames.push(new Uint8Array(buffer.subarray(offset, offset + length)));
      offset += length;
    }
    return frames;
  }

  append(frame: Uint8Array): void {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(frame.byteLength, 0);
    writeFileSync(this.path, Buffer.concat([header, Buffer.from(frame)]), { flag: 'a' });
  }

  /** Atomically replaces the log with a single checkpoint frame. */
  compact(checkpoint: Uint8Array): void {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(checkpoint.byteLength, 0);
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, Buffer.concat([header, Buffer.from(checkpoint)]));
    renameSync(tmp, this.path);
  }
}
