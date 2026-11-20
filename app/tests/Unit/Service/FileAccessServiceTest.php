<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Service;

use OCA\BetterOffice\Service\FileAccessDeniedException;
use OCA\BetterOffice\Service\FileAccessService;
use OCA\BetterOffice\Service\FileNotFoundException;
use OCA\BetterOffice\Service\FileTooLargeException;
use OCA\BetterOffice\Service\UnsupportedFileTypeException;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use PHPUnit\Framework\TestCase;

class FileAccessServiceTest extends TestCase {
	private const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

	private IRootFolder $rootFolder;
	private Folder $userFolder;
	private FileAccessService $service;

	protected function setUp(): void {
		$this->rootFolder = $this->createStub(IRootFolder::class);
		$this->userFolder = $this->createStub(Folder::class);
		$this->rootFolder->method('getUserFolder')->willReturn($this->userFolder);
		$this->service = new FileAccessService($this->rootFolder);
	}

	private function docxFile(bool $readable = true, bool $updateable = true, int $size = 1024): File {
		$file = $this->createStub(File::class);
		$file->method('getMimeType')->willReturn(self::DOCX_MIME);
		$file->method('getSize')->willReturn($size);
		$file->method('isReadable')->willReturn($readable);
		$file->method('isUpdateable')->willReturn($updateable);
		return $file;
	}

	public function testGetReadableFileReturnsTheFile(): void {
		$file = $this->docxFile();
		$this->userFolder->method('getById')->willReturn([$file]);

		self::assertSame($file, $this->service->getReadableFile('alice', 42));
	}

	public function testGetReadableFileThrowsWhenNothingFound(): void {
		$this->userFolder->method('getById')->willReturn([]);

		$this->expectException(FileNotFoundException::class);
		$this->service->getReadableFile('alice', 42);
	}

	public function testChangingTheFileIdToOneAliceCannotAccessFindsNothing(): void {
		// alice's own folder simply never returns a node for a file id she
		// has no share/ownership access to -- this is the mechanism that
		// makes "change the file id in the request" harmless (PLAN.md §6.3).
		$this->userFolder->method('getById')->willReturn([]);

		$this->expectException(FileNotFoundException::class);
		$this->service->getReadableFile('alice', 999);
	}

	public function testGetReadableFileThrowsWhenNotReadable(): void {
		$file = $this->docxFile(readable: false);
		$this->userFolder->method('getById')->willReturn([$file]);

		$this->expectException(FileAccessDeniedException::class);
		$this->service->getReadableFile('alice', 42);
	}

	public function testGetWritableFileThrowsWhenReadableButNotUpdateable(): void {
		$file = $this->docxFile(readable: true, updateable: false);
		$this->userFolder->method('getById')->willReturn([$file]);

		$this->expectException(FileAccessDeniedException::class);
		$this->service->getWritableFile('alice', 42);
	}

	public function testGetReadableFileThrowsOnUnsupportedMimeType(): void {
		$file = $this->createStub(File::class);
		$file->method('getMimeType')->willReturn('application/pdf');
		$file->method('getSize')->willReturn(1024);
		$this->userFolder->method('getById')->willReturn([$file]);

		$this->expectException(UnsupportedFileTypeException::class);
		$this->service->getReadableFile('alice', 42);
	}

	public function testGetReadableFileThrowsWhenTooLarge(): void {
		$file = $this->docxFile(size: FileAccessService::MAX_FILE_SIZE_BYTES + 1);
		$this->userFolder->method('getById')->willReturn([$file]);

		$this->expectException(FileTooLargeException::class);
		$this->service->getReadableFile('alice', 42);
	}

	public function testGetReadableFileThrowsWhenFolderReturnsANonFileNode(): void {
		$folder = $this->createStub(Folder::class);
		$this->userFolder->method('getById')->willReturn([$folder]);

		$this->expectException(FileNotFoundException::class);
		$this->service->getReadableFile('alice', 42);
	}
}
