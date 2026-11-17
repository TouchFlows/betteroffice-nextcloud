/**
 * Mirrors the plan's atomic room initialisation (§8.2) against the relay's
 * stand-in seed registry: the owner generates the seed and PUTs it
 * create-if-absent, adopting the authoritative one back if it lost the race;
 * everyone else just GETs the one seed on record and never generates their
 * own. In Phase 2 this moves to the Nextcloud app backend and
 * `betteroffice_sessions`, not the relay.
 */
export async function resolveRoomSeed(
  relayUrl: string,
  room: string,
  isOwner: boolean,
  generate: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const httpBase = relayUrl.replace(/^ws/, 'http');
  const url = `${httpBase}/room/${encodeURIComponent(room)}/seed`;

  if (isOwner) {
    const seed = await generate();
    const response = await fetch(url, { method: 'PUT', body: new Blob([seed as BlobPart]) });
    return new Uint8Array(await response.arrayBuffer());
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await fetch(url);
    if (response.status === 200) return new Uint8Array(await response.arrayBuffer());
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`room ${room} has no seed yet`);
}
