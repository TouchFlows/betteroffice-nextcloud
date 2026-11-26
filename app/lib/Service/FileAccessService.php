<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

use OCP\Files\File;
use OCP\Files\IRootFolder;

/**
 * Resolves a file ID to a Node scoped to the requesting user's own folder
 * (PLAN.md §6.3): `getUserFolder($userId)->getById($fileId)` returns nothing
 * for a file the user has no share/ownership access to, which is what makes
 * changing a file ID in a request harmless rather than a path to someone
 * else's file. Every call re-resolves the node from the live filesystem --
 * nothing here is cached across requests -- so permission and existence
 * checks are always current (§6.3 "recheck permissions before every save").
 */
class FileAccessService {
	/**
	 * Every format BetterOffice opens, keyed by mime type and valued with the
	 * format identifier both the room and the client use. The format is part
	 * of the room's identity (`RoomService::computeRoomId` hashes
	 * instance|file|format), so it is read off the file's own mime type
	 * rather than assumed per request: a file must never land in a room
	 * created for a different format.
	 */
	public const SUPPORTED_FORMATS = [
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
		'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
	];

	/**
	 * Conservative starting point, not a measured limit (PLAN.md §16 covers
	 * that later). Revisit once real documents are tested through the editor.
	 */
	public const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

	public function __construct(
		private IRootFolder $rootFolder,
	) {
	}

	/**
	 * The format identifier for a mime type, or an exception for a file type
	 * this app does not open. Callers resolve the file through this service
	 * first, so an unsupported mime type normally fails earlier -- this is the
	 * single source of truth either way, not a second list to keep in sync.
	 *
	 * @throws UnsupportedFileTypeException
	 */
	public static function formatForMimeType(string $mimeType): string {
		return self::SUPPORTED_FORMATS[$mimeType]
			?? throw new UnsupportedFileTypeException("Unsupported mime type {$mimeType}");
	}

	/** @throws FileNotFoundException|FileAccessDeniedException|UnsupportedFileTypeException|FileTooLargeException */
	public function getReadableFile(string $userId, int $fileId): File {
		$file = $this->resolve($userId, $fileId);
		if (!$file->isReadable()) {
			throw new FileAccessDeniedException("File {$fileId} is not readable by {$userId}");
		}
		return $file;
	}

	/** @throws FileNotFoundException|FileAccessDeniedException|UnsupportedFileTypeException|FileTooLargeException */
	public function getWritableFile(string $userId, int $fileId): File {
		$file = $this->resolve($userId, $fileId);
		if (!$file->isReadable() || !$file->isUpdateable()) {
			throw new FileAccessDeniedException("File {$fileId} is not writable by {$userId}");
		}
		return $file;
	}

	private function resolve(string $userId, int $fileId): File {
		$userFolder = $this->rootFolder->getUserFolder($userId);
		$nodes = $userFolder->getById($fileId);
		$node = $nodes[0] ?? null;

		if (!$node instanceof File) {
			throw new FileNotFoundException("File {$fileId} not found for {$userId}");
		}
		if (!isset(self::SUPPORTED_FORMATS[$node->getMimeType()])) {
			throw new UnsupportedFileTypeException("File {$fileId} has unsupported mime type {$node->getMimeType()}");
		}
		if ($node->getSize() > self::MAX_FILE_SIZE_BYTES) {
			throw new FileTooLargeException("File {$fileId} exceeds the " . self::MAX_FILE_SIZE_BYTES . ' byte limit');
		}

		return $node;
	}
}
