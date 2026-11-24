<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

use OCP\Lock\ILockingProvider;

/**
 * The non-collaborative read/save path (PLAN.md Phase 2: "Basic DOCX
 * editing", "Safe file saving"). Save-lease/fencing-token coordination for
 * concurrent collaborative saves is Phase 5 -- this is the single-editor
 * case: compare the ETag the caller read against the live one, write only
 * on a match (§9.3 steps 4-8, minus the collaboration-specific steps and
 * minus manual locking -- see save()'s own docblock for why).
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

		// No manual lock()/unlock() here: File::putContent() always runs its
		// own full lock lifecycle internally (lockFile(LOCK_SHARED), then
		// changeLock(LOCK_EXCLUSIVE), write, changeLock back, unlock) via
		// View::basicOperation(). Pre-acquiring any lock ourselves collides
		// with that -- an outer LOCK_EXCLUSIVE leaves the stored lock value
		// as the string "exclusive" where putContent()'s own inner
		// lockFile(LOCK_SHARED) expects an integer holder count (so it always
		// throws LockedException), and an outer LOCK_SHARED makes the holder
		// count 2 where putContent()'s own changeLock(LOCK_EXCLUSIVE) requires
		// it to be exactly 1. Confirmed live against a real Nextcloud 34
		// instance (MemcacheLockingProvider::acquireLock/changeLock,
		// lib/private/Lock/MemcacheLockingProvider.php) -- matches how
		// Nextcloud's own bundled apps (text, richdocuments) call
		// putContent() themselves, with no manual lock around it.
		//
		// This leaves a narrow window between the ETag check below and
		// putContent()'s own internal lock acquisition where a concurrent
		// write could land unnoticed -- acceptable for Phase 2's
		// non-collaborative save path; atomic check-and-write under
		// concurrent collaborative saves is Phase 5 scope (save-lease/
		// fencing-token coordination, PLAN.md §9.2-9.3).
		if ($file->getEtag() !== $expectedEtag) {
			throw new StaleEtagException("File {$fileId} was modified; expected etag {$expectedEtag}, found {$file->getEtag()}");
		}
		$file->putContent($content);
		return $file->getEtag();
	}
}
