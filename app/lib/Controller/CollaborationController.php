<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Controller;

use OCA\BetterOffice\Service\FileAccessDeniedException;
use OCA\BetterOffice\Service\FileAccessService;
use OCA\BetterOffice\Service\FileNotFoundException;
use OCA\BetterOffice\Service\FileTooLargeException;
use OCA\BetterOffice\Service\RoomService;
use OCA\BetterOffice\Service\UnsupportedFileTypeException;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;

/**
 * Issues the room id and short-lived collaboration token a client needs to
 * connect to the relay (PLAN.md §8.2, §8.5). Reached by the editor's own
 * authenticated fetch, same as DocumentController -- not a plain
 * navigation, so (unlike EditorController/PageController) this keeps CSRF
 * enforcement on.
 */
class CollaborationController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private FileAccessService $fileAccess,
		private RoomService $rooms,
		private IURLGenerator $urlGenerator,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function session(int $fileId): JSONResponse {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return new JSONResponse(['message' => 'Not authenticated'], Http::STATUS_UNAUTHORIZED);
		}
		$userId = $user->getUID();

		try {
			$file = $this->fileAccess->getReadableFile($userId, $fileId);
		} catch (FileNotFoundException) {
			return new JSONResponse(['message' => 'File not found'], Http::STATUS_NOT_FOUND);
		} catch (FileAccessDeniedException) {
			return new JSONResponse(['message' => 'You do not have access to this file'], Http::STATUS_FORBIDDEN);
		} catch (UnsupportedFileTypeException) {
			return new JSONResponse(['message' => 'BetterOffice does not support this file type'], Http::STATUS_UNSUPPORTED_MEDIA_TYPE);
		} catch (FileTooLargeException) {
			return new JSONResponse(['message' => 'This file is too large to open'], Http::STATUS_REQUEST_ENTITY_TOO_LARGE);
		}

		// DOCX only -- the same Phase 3/4 constraint FileAccessService's
		// supported-mime-type list already enforces.
		$session = $this->rooms->resolveSession($fileId, 'docx', $file->getEtag());
		$role = $file->isUpdateable() ? 'write' : 'read';

		return new JSONResponse([
			'roomId' => $session->getRoomId(),
			// Presence identity (§8.6): the avatar is a public core route, so
			// peers can render it with no more permission than the file access
			// they already proved by getting this token.
			'token' => $this->rooms->issueToken(
				$session,
				$userId,
				$role,
				$user->getDisplayName(),
				$this->urlGenerator->linkToRouteAbsolute('core.Avatar.getAvatar', [
					'userId' => $userId,
					'size' => 64,
				]),
			),
			'role' => $role,
			'seed' => $session->getSeed() === null ? null : base64_encode($session->getSeed()),
		]);
	}

	/**
	 * Atomic seed create-if-absent (§8.2 steps 4-6). Generating a seed
	 * isn't an edit, so this doesn't require the write role `session()`
	 * reports -- a read-only viewer may still be the first to open a
	 * document that has never been seeded, and must be able to unblock
	 * that, not just whoever has write access.
	 */
	#[NoAdminRequired]
	public function seed(int $fileId): JSONResponse {
		$userId = $this->userSession->getUser()?->getUID();
		if ($userId === null) {
			return new JSONResponse(['message' => 'Not authenticated'], Http::STATUS_UNAUTHORIZED);
		}

		try {
			$file = $this->fileAccess->getReadableFile($userId, $fileId);
		} catch (FileNotFoundException) {
			return new JSONResponse(['message' => 'File not found'], Http::STATUS_NOT_FOUND);
		} catch (FileAccessDeniedException) {
			return new JSONResponse(['message' => 'You do not have access to this file'], Http::STATUS_FORBIDDEN);
		} catch (UnsupportedFileTypeException) {
			return new JSONResponse(['message' => 'BetterOffice does not support this file type'], Http::STATUS_UNSUPPORTED_MEDIA_TYPE);
		} catch (FileTooLargeException) {
			return new JSONResponse(['message' => 'This file is too large to open'], Http::STATUS_REQUEST_ENTITY_TOO_LARGE);
		}

		$offeredSeed = file_get_contents('php://input');
		if ($offeredSeed === false || $offeredSeed === '') {
			return new JSONResponse(['message' => 'A non-empty seed body is required'], Http::STATUS_BAD_REQUEST);
		}

		$session = $this->rooms->resolveSession($fileId, 'docx', $file->getEtag());
		$seed = $this->rooms->resolveSeed($session, $offeredSeed);

		return new JSONResponse(['seed' => base64_encode($seed)]);
	}
}
