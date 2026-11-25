import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies the short-lived collaboration token the Nextcloud app issues
 * (PLAN.md §8.5), hand-rolled rather than a JWT library on either side: a
 * JWT-shaped `header.payload.signature` compact token, HS256, signed with a
 * secret shared out-of-band between the app and this relay (the same
 * "internal secret" pattern Nextcloud Talk uses for its signaling backend).
 * The matching issuer is `app/lib/Service/RoomService.php`.
 */
export interface CollaborationTokenClaims {
	/** Nextcloud instance id, scoping room ids to one installation (§8.1). */
	iid: string;
	/** Nextcloud user id. */
	sub: string;
	/**
	 * Display name for presence (PLAN.md §8.6). Optional only so a token
	 * issued moments before an upgrade keeps working until it expires.
	 */
	name?: string;
	/** Absolute Nextcloud avatar URL for presence; absent or null when there is none. */
	avatar?: string | null;
	/** Nextcloud file id. */
	fid: number;
	/** The room this token authorises -- must match the room being joined. */
	roomId: string;
	format: 'docx' | 'xlsx' | 'pptx';
	/** Read-only tokens must not be allowed to submit editing updates (§8.5, §13). */
	role: 'read' | 'write';
	/** Expiration, Unix seconds. */
	exp: number;
	/** Unique token id (§8.5) -- carried for audit logging; this relay does not yet track used jtis (Phase 5/6). */
	jti: string;
}

/** Matches the client's own awareness-state bound (`Awareness user name exceeds 1024 characters`). */
const MAX_NAME_LENGTH = 1024;
const MAX_AVATAR_URL_LENGTH = 2048;

export class TokenVerificationError extends Error {
	constructor(readonly reason: 'malformed' | 'bad-signature' | 'expired' | 'revoked') {
		super(`collaboration token rejected: ${reason}`);
	}
}

function base64UrlDecode(segment: string): Buffer {
	return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * @param nowSeconds Injectable for tests; defaults to the real clock.
 * @param revokedJtis Token ids withdrawn after they were signed. A signature
 *   cannot be un-signed, so withdrawal is state the relay has to hold; the
 *   e2e harness is the only caller that fills it in (see `testControl.ts`).
 */
export function verifyCollaborationToken(
	token: string,
	secret: string,
	nowSeconds: number = Math.floor(Date.now() / 1000),
	revokedJtis?: ReadonlySet<string>,
): CollaborationTokenClaims {
	const parts = token.split('.');
	if (parts.length !== 3) throw new TokenVerificationError('malformed');
	const [headerPart, payloadPart, signaturePart] = parts;

	const expected = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest();
	let actual: Buffer;
	try {
		actual = base64UrlDecode(signaturePart);
	} catch {
		throw new TokenVerificationError('malformed');
	}
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
		throw new TokenVerificationError('bad-signature');
	}

	let claims: CollaborationTokenClaims;
	try {
		claims = JSON.parse(base64UrlDecode(payloadPart).toString('utf8'));
	} catch {
		throw new TokenVerificationError('malformed');
	}
	if (
		typeof claims.exp !== 'number' ||
		typeof claims.roomId !== 'string' ||
		(claims.role !== 'read' && claims.role !== 'write')
	) {
		throw new TokenVerificationError('malformed');
	}
	// Presence is broadcast to everyone else in the room, so a malformed or
	// oversized identity must be refused here rather than relayed (§13).
	if (
		(claims.name !== undefined && (typeof claims.name !== 'string' || claims.name.length > MAX_NAME_LENGTH)) ||
		(claims.avatar !== undefined &&
			claims.avatar !== null &&
			(typeof claims.avatar !== 'string' || claims.avatar.length > MAX_AVATAR_URL_LENGTH))
	) {
		throw new TokenVerificationError('malformed');
	}
	if (claims.exp <= nowSeconds) throw new TokenVerificationError('expired');
	if (typeof claims.jti === 'string' && revokedJtis?.has(claims.jti)) {
		throw new TokenVerificationError('revoked');
	}

	return claims;
}
