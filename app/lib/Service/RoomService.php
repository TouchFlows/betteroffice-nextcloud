<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

use OCA\BetterOffice\Db\Session;
use OCA\BetterOffice\Db\SessionMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DBException;
use OCP\IConfig;

/**
 * Room identity, atomic session/seed initialisation, and collaboration
 * token issuance (PLAN.md §8.1, §8.2, §8.5). The relay never computes a
 * room id or sees a file id -- it only ever receives the opaque room id
 * already resolved here, and verifies the token this issues
 * (`relay/src/token.ts`).
 */
class RoomService {
	private const TOKEN_TTL_SECONDS = 300;

	public function __construct(
		private SessionMapper $sessions,
		private SharedSecretService $secret,
		private IConfig $config,
		private ITimeFactory $time,
	) {
	}

	public function instanceId(): string {
		return $this->config->getSystemValue('instanceid', '');
	}

	/** A stable opaque id, keyed so it can't be guessed or reused across installations (§8.1). */
	public function computeRoomId(string $instanceId, int $fileId, string $format): string {
		return hash_hmac('sha256', "{$instanceId}|{$fileId}|{$format}", $this->secret->getSecret());
	}

	/**
	 * Atomic room/seed initialisation (§8.2 steps 1-6; steps 7-8, applying
	 * persisted updates and connecting the provider, are the frontend's
	 * job once it has this session's room id). Returns the one
	 * authoritative session for this file+format: the row this call just
	 * created, or -- if another request already created it first -- that
	 * existing row, never a second, different one.
	 */
	public function resolveSession(int $fileId, string $format, string $currentEtag): Session {
		$instanceId = $this->instanceId();

		try {
			return $this->sessions->findByIdentity($instanceId, $fileId, $format);
		} catch (DoesNotExistException) {
			// No session yet -- fall through to create one.
		}

		$session = new Session();
		$session->setInstanceId($instanceId);
		$session->setFileId($fileId);
		$session->setFormat($format);
		$session->setRoomId($this->computeRoomId($instanceId, $fileId, $format));
		$session->setInitialEtag($currentEtag);
		$session->setSavedEtag($currentEtag);
		$session->setStatus('active');
		$now = $this->time->now();
		$session->setCreatedAt($now);
		$session->setUpdatedAt($now);

		try {
			return $this->sessions->insert($session);
		} catch (DBException $exception) {
			if ($exception->getReason() !== DBException::REASON_CONSTRAINT_VIOLATION) {
				throw $exception;
			}
			// Lost the race to create it -- adopt the one that won instead
			// of silently seeding a second, divergent room for this file.
			return $this->sessions->findByIdentity($instanceId, $fileId, $format);
		}
	}

	/**
	 * Short-lived HS256 token (§8.5), verified by `relay/src/token.ts`.
	 * Hand-rolled rather than a JWT library on either side -- see that
	 * file's own docblock.
	 *
	 * `$displayName` and `$avatarUrl` are the presence identity (§8.6). They
	 * are signed here, by the authority on who this user is, so the relay can
	 * report collaborators without trusting anything a browser sends about
	 * itself -- and without the relay needing Nextcloud credentials.
	 */
	public function issueToken(
		Session $session,
		string $userId,
		string $role,
		string $displayName,
		string $avatarUrl,
	): string {
		$claims = [
			'iid' => $session->getInstanceId(),
			'sub' => $userId,
			'name' => $displayName,
			'avatar' => $avatarUrl,
			'fid' => $session->getFileId(),
			'roomId' => $session->getRoomId(),
			'format' => $session->getFormat(),
			'role' => $role,
			'exp' => $this->time->getTime() + self::TOKEN_TTL_SECONDS,
			'jti' => bin2hex(random_bytes(16)),
		];

		$header = self::base64UrlEncode((string)json_encode(['alg' => 'HS256', 'typ' => 'JWT'], JSON_THROW_ON_ERROR));
		$payload = self::base64UrlEncode((string)json_encode($claims, JSON_THROW_ON_ERROR));
		$signature = hash_hmac('sha256', "{$header}.{$payload}", $this->secret->getSecret(), true);

		return "{$header}.{$payload}." . self::base64UrlEncode($signature);
	}

	/**
	 * Atomic seed create-if-absent (§8.2 steps 4-6): the Nextcloud app
	 * cannot generate a CRDT seed itself (that needs the BetterOffice WASM
	 * engine, browser-only), so whichever client gets here first with one
	 * wins, and every other client -- regardless of arrival order -- adopts
	 * exactly those bytes instead of seeding its own, independently
	 * divergent room.
	 *
	 * @return string The seed now on record: the caller's own bytes if it
	 *                won, or whoever else's if it lost the race.
	 */
	public function resolveSeed(Session $session, string $offeredSeed): string {
		if ($this->sessions->trySetSeed($session->getId(), $offeredSeed)) {
			return $offeredSeed;
		}

		$authoritative = $this->sessions->findByIdentity(
			$session->getInstanceId(),
			$session->getFileId(),
			$session->getFormat(),
		);
		$seed = $authoritative->getSeed();
		if ($seed === null) {
			// Only reachable if trySetSeed's own WHERE clause (seed IS NULL)
			// and this read observed inconsistent states of the same
			// committed row -- a configuration/isolation-level bug, not a
			// normal race outcome.
			throw new \RuntimeException("Session {$session->getId()} has no seed despite losing the create-if-absent race");
		}
		return $seed;
	}

	private static function base64UrlEncode(string $data): string {
		return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
	}
}
