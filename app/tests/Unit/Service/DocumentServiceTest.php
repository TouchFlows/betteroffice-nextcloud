<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Service;

use OCA\BetterOffice\Service\DocumentService;
use OCA\BetterOffice\Service\FileAccessDeniedException;
use OCA\BetterOffice\Service\FileAccessService;
use OCA\BetterOffice\Service\StaleEtagException;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Lock\ILockingProvider;
use PHPUnit\Framework\TestCase;

class DocumentServiceTest extends TestCase {
	private FileAccessService $fileAccess;
	private DocumentService $service;

	protected function setUp(): void {
		$this->fileAccess = $this->createStub(FileAccessService::class);
		$this->service = new DocumentService($this->fileAccess);
	}

	public function testReadLocksSharedAndAlwaysUnlocks(): void {
		$file = $this->createMock(File::class);
		$file->method('getContent')->willReturn('docx bytes');
		$file->method('getEtag')->willReturn('"etag-1"');
		$file->method('getMimeType')->willReturn('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		$file->method('getName')->willReturn('report.docx');
		$this->fileAccess->method('getReadableFile')->willReturn($file);

		$file->expects(self::once())->method('lock')->with(ILockingProvider::LOCK_SHARED);
		$file->expects(self::once())->method('unlock')->with(ILockingProvider::LOCK_SHARED);

		$document = $this->service->read('alice', 42);

		self::assertSame('docx bytes', $document->content);
		self::assertSame('"etag-1"', $document->etag);
		self::assertSame('report.docx', $document->fileName);
	}

	public function testReadUnlocksEvenWhenGetContentThrows(): void {
		$file = $this->createMock(File::class);
		$file->method('getContent')->willThrowException(new \RuntimeException('boom'));
		$this->fileAccess->method('getReadableFile')->willReturn($file);

		$file->expects(self::once())->method('unlock')->with(ILockingProvider::LOCK_SHARED);

		$this->expectException(\RuntimeException::class);
		$this->service->read('alice', 42);
	}

	public function testSaveWritesWhenEtagMatchesAndReturnsTheNewEtag(): void {
		// No lock()/unlock() expectations: File::putContent() runs its own
		// full lock lifecycle internally. See the docblock on
		// DocumentService::save() for why a caller-held lock breaks it.
		$file = $this->createMock(File::class);
		$file->method('getEtag')->willReturnOnConsecutiveCalls('"etag-1"', '"etag-2"');
		$this->fileAccess->method('getWritableFile')->willReturn($file);

		$file->expects(self::once())->method('putContent')->with('new bytes');

		$newEtag = $this->service->save('alice', 42, 'new bytes', '"etag-1"');

		self::assertSame('"etag-2"', $newEtag);
	}

	/**
	 * The endpoint's own read-only guard, below the controller: a file the
	 * session may only read must be refused by save() itself, before the ETag
	 * is compared and before anything is written. `readOnly` in the page is a
	 * convenience on top of this, never the only thing refusing the write.
	 *
	 * The real FileAccessService is used rather than a stub of
	 * getWritableFile: stubbing the method under test would assert the wiring
	 * and not the permission check this path actually runs.
	 */
	public function testSaveRefusesAFileTheSessionMayNotUpdateWithoutWriting(): void {
		$file = $this->createMock(File::class);
		$file->method('getMimeType')->willReturn('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		$file->method('getSize')->willReturn(1024);
		$file->method('isReadable')->willReturn(true);
		$file->method('isUpdateable')->willReturn(false);
		$file->method('getEtag')->willReturn('"etag-1"');
		$file->expects(self::never())->method('putContent');

		$userFolder = $this->createStub(Folder::class);
		$userFolder->method('getById')->willReturn([$file]);
		$rootFolder = $this->createStub(IRootFolder::class);
		$rootFolder->method('getUserFolder')->willReturn($userFolder);

		$service = new DocumentService(new FileAccessService($rootFolder));

		$this->expectException(FileAccessDeniedException::class);
		$service->save('alice', 42, 'new bytes', '"etag-1"');
	}

	public function testSaveRefusesAndNeverWritesWhenEtagIsStale(): void {
		$file = $this->createMock(File::class);
		$file->method('getEtag')->willReturn('"etag-current"');
		$this->fileAccess->method('getWritableFile')->willReturn($file);

		$file->expects(self::never())->method('putContent');

		$this->expectException(StaleEtagException::class);
		$this->service->save('alice', 42, 'new bytes', '"etag-stale"');
	}
}
