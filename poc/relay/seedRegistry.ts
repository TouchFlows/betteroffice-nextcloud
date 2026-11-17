import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface NodeErrnoException extends Error {
  code?: string;
}

/**
 * Stands in for the Nextcloud-app-owned `betteroffice_sessions` row (§5.1,
 * §8.2) that will hold a room's authoritative seed in Phase 2+. A PoC-only
 * file store, but the create-if-absent semantics are real: `wx` is the OS
 * atomic "fail if it already exists" open, the same guarantee §8.2 step 4
 * calls for.
 */
export class SeedRegistry {
  constructor(private readonly dataDir: string) {}

  private pathFor(roomId: string): string {
    const digest = createHash('sha256').update(roomId).digest('hex');
    return join(this.dataDir, `${digest}.seed`);
  }

  get(roomId: string): Uint8Array | null {
    const path = this.pathFor(roomId);
    if (!existsSync(path)) return null;
    return new Uint8Array(readFileSync(path));
  }

  /** Returns the seed now on record: ours if we won the race, the existing one if we lost it. */
  createIfAbsent(roomId: string, bytes: Uint8Array): { created: boolean; bytes: Uint8Array } {
    const path = this.pathFor(roomId);
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, bytes, { flag: 'wx' });
      return { created: true, bytes };
    } catch (error) {
      if ((error as NodeErrnoException).code !== 'EEXIST') throw error;
      return { created: false, bytes: new Uint8Array(readFileSync(path)) };
    }
  }
}
