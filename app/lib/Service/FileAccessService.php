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
	/** DOCX only for now; XLSX/PPTX join once their editors are wired (Phase 4). */
	public const SUPPORTED_MIME_TYPES = [
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
		if (!in_array($node->getMimeType(), self::SUPPORTED_MIME_TYPES, true)) {
			throw new UnsupportedFileTypeException("File {$fileId} has unsupported mime type {$node->getMimeType()}");
		}
		if ($node->getSize() > self::MAX_FILE_SIZE_BYTES) {
			throw new FileTooLargeException("File {$fileId} exceeds the " . self::MAX_FILE_SIZE_BYTES . ' byte limit');
		}

		return $node;
	}
}
