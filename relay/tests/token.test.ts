import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { verifyCollaborationToken, TokenVerificationError, type CollaborationTokenClaims } from '../src/token.js';

const SECRET = 'test-shared-secret';

function base64Url(buffer: Buffer): string {
	return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(claims: CollaborationTokenClaims, secret: string): string {
	const header = base64Url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
	const payload = base64Url(Buffer.from(JSON.stringify(claims)));
	const signature = base64Url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
	return `${header}.${payload}.${signature}`;
}

function validClaims(overrides: Partial<CollaborationTokenClaims> = {}): CollaborationTokenClaims {
	return {
		iid: 'instance-1',
		sub: 'alice',
		fid: 42,
		roomId: 'room-abc',
		format: 'docx',
		role: 'write',
		exp: Math.floor(Date.now() / 1000) + 300,
		jti: 'token-1',
		...overrides,
	};
}

test('a validly signed, unexpired token verifies and returns its claims', () => {
	const claims = validClaims();
	const token = sign(claims, SECRET);
	const result = verifyCollaborationToken(token, SECRET);
	assert.deepEqual(result, claims);
});

test('a token signed with a different secret is rejected', () => {
	const token = sign(validClaims(), 'wrong-secret');
	assert.throws(() => verifyCollaborationToken(token, SECRET), (error: unknown) => {
		assert.ok(error instanceof TokenVerificationError);
		assert.equal(error.reason, 'bad-signature');
		return true;
	});
});

test('an expired token is rejected even with a valid signature', () => {
	const claims = validClaims({ exp: Math.floor(Date.now() / 1000) - 10 });
	const token = sign(claims, SECRET);
	assert.throws(() => verifyCollaborationToken(token, SECRET), (error: unknown) => {
		assert.ok(error instanceof TokenVerificationError);
		assert.equal(error.reason, 'expired');
		return true;
	});
});

test('a token with the wrong number of segments is rejected as malformed', () => {
	assert.throws(() => verifyCollaborationToken('not-a-token', SECRET), (error: unknown) => {
		assert.ok(error instanceof TokenVerificationError);
		assert.equal(error.reason, 'malformed');
		return true;
	});
});

test('a payload missing required claims is rejected as malformed', () => {
	const header = base64Url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
	const payload = base64Url(Buffer.from(JSON.stringify({ iid: 'instance-1' })));
	const signature = base64Url(createHmac('sha256', SECRET).update(`${header}.${payload}`).digest());
	assert.throws(() => verifyCollaborationToken(`${header}.${payload}.${signature}`, SECRET), (error: unknown) => {
		assert.ok(error instanceof TokenVerificationError);
		assert.equal(error.reason, 'malformed');
		return true;
	});
});

test('a token whose jti was revoked is rejected even with a valid signature', () => {
	const claims = validClaims();
	const token = sign(claims, SECRET);
	// Verifies on its own terms, so only the withdrawal can be what refuses it.
	assert.equal(verifyCollaborationToken(token, SECRET).jti, claims.jti);
	assert.throws(
		() => verifyCollaborationToken(token, SECRET, undefined, new Set([claims.jti])),
		(error: unknown) => {
			assert.ok(error instanceof TokenVerificationError);
			assert.equal(error.reason, 'revoked');
			return true;
		},
	);
});

test('a read role is preserved through verification', () => {
	const claims = validClaims({ role: 'read' });
	const token = sign(claims, SECRET);
	assert.equal(verifyCollaborationToken(token, SECRET).role, 'read');
});
