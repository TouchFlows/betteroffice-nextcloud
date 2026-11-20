<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Service;

use OCA\BetterOffice\Service\DocumentService;
use OCA\BetterOffice\Service\FileAccessService;
use OCA\BetterOffice\Service\StaleEtagException;
use OCP\Files\File;
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
		$file = $this->createMock(File::class);
		$file->method('getEtag')->willReturnOnConsecutiveCalls('"etag-1"', '"etag-2"');
		$this->fileAccess->method('getWritableFile')->willReturn($file);

		$file->expects(self::once())->method('putContent')->with('new bytes');
		$file->expects(self::once())->method('lock')->with(ILockingProvider::LOCK_EXCLUSIVE);
		$file->expects(self::once())->method('unlock')->with(ILockingProvider::LOCK_EXCLUSIVE);

		$newEtag = $this->service->save('alice', 42, 'new bytes', '"etag-1"');

		self::assertSame('"etag-2"', $newEtag);
	}

	public function testSaveRefusesAndNeverWritesWhenEtagIsStale(): void {
		$file = $this->createMock(File::class);
		$file->method('getEtag')->willReturn('"etag-current"');
		$this->fileAccess->method('getWritableFile')->willReturn($file);

		$file->expects(self::never())->method('putContent');
		$file->expects(self::once())->method('unlock')->with(ILockingProvider::LOCK_EXCLUSIVE);

		$this->expectException(StaleEtagException::class);
		$this->service->save('alice', 42, 'new bytes', '"etag-stale"');
	}
}
