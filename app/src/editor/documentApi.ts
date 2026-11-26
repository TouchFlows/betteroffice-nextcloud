import axios from '@nextcloud/axios';
import { generateUrl } from '@nextcloud/router';

/**
 * The document endpoints every editor talks to. Kept in one place because the
 * three editors load and save through the identical route; only the bytes
 * they hand back differ (PLAN.md §9.1: the editor APIs own serialisation, the
 * host owns the write).
 */
export function documentUrl(fileId: number): string {
	return generateUrl('/apps/betteroffice/document/{fileId}', { fileId });
}

export interface LoadedDocument {
	bytes: Uint8Array;
	/** The ETag these bytes came with; a save must present it as `If-Match`. */
	etag: string;
}

export async function loadDocument(fileId: number): Promise<LoadedDocument> {
	const response = await axios.get<ArrayBuffer>(documentUrl(fileId), { responseType: 'arraybuffer' });
	return {
		bytes: new Uint8Array(response.data),
		etag: response.headers.etag as string,
	};
}

/**
 * Writes the whole file back and returns the ETag of the new version.
 *
 * `If-Match` is not optional: the server refuses a save whose ETag no longer
 * matches the stored file (§9.3), so passing the ETag the bytes were loaded
 * with is what stops this write from overwriting someone else's.
 */
export async function saveDocument(fileId: number, bytes: Uint8Array, etag: string): Promise<string> {
	const response = await axios.put(documentUrl(fileId), bytes, {
		headers: {
			'If-Match': etag,
			'Content-Type': 'application/octet-stream',
		},
	});
	return response.headers.etag as string;
}
