<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

use OCP\Lock\ILockingProvider;

/**
 * The non-collaborative read/save path (PLAN.md Phase 2: "Basic DOCX
 * editing", "Safe file saving"). Save-lease/fencing-token coordination for
 * concurrent collaborative saves is Phase 5 -- this is the single-editor
 * case: lock, compare the ETag the caller read against the live one, write
 * only on a match, unlock (§9.3 steps 4-8, minus the collaboration-specific
 * steps).
 */
class DocumentService {
	public function __construct(
		private FileAccessService $fileAccess,
	) {
	}

	/** @throws FileNotFoundException|FileAccessDeniedException|UnsupportedFileTypeException|FileTooLargeException */
	public function read(string $userId, int $fileId): Document {
		$file = $this->fileAccess->getReadableFile($userId, $fileId);

		$file->lock(ILockingProvider::LOCK_SHARED);
		try {
			return new Document(
				content: $file->getContent(),
				etag: $file->getEtag(),
				mimeType: $file->getMimeType(),
				fileName: $file->getName(),
			);
		} finally {
			$file->unlock(ILockingProvider::LOCK_SHARED);
		}
	}

	/**
	 * @throws FileNotFoundException|FileAccessDeniedException|UnsupportedFileTypeException|FileTooLargeException
	 * @throws StaleEtagException
	 * @return string the new ETag
	 */
	public function save(string $userId, int $fileId, string $content, string $expectedEtag): string {
		$file = $this->fileAccess->getWritableFile($userId, $fileId);

		$file->lock(ILockingProvider::LOCK_EXCLUSIVE);
		try {
			if ($file->getEtag() !== $expectedEtag) {
				throw new StaleEtagException("File {$fileId} was modified; expected etag {$expectedEtag}, found {$file->getEtag()}");
			}
			$file->putContent($content);
			return $file->getEtag();
		} finally {
			$file->unlock(ILockingProvider::LOCK_EXCLUSIVE);
		}
	}
}
