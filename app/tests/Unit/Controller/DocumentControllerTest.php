<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Controller;

use OCA\BetterOffice\Controller\DocumentController;
use OCA\BetterOffice\Service\DocumentService;
use OCA\BetterOffice\Service\FileAccessDeniedException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\TestCase;

class DocumentControllerTest extends TestCase {
	/**
	 * What the endpoint answers when the file is readable but not updateable.
	 * FileAccessService::getWritableFile() refuses that file and
	 * DocumentService::save() propagates the exception, so the only question
	 * left is the status: 403, not the 409 a stale ETag would give and not a
	 * 200 that would make a client-side read-only bug invisible.
	 *
	 * This is the server half of the read-only path. The editor refuses the
	 * save itself (see the e2e viewer specs), but that is a convenience: a
	 * client that skipped it must still be stopped here.
	 */
	public function testSaveAnswersForbiddenForAFileTheSessionMayNotUpdate(): void {
		$user = $this->createStub(IUser::class);
		$user->method('getUID')->willReturn('alice');

		$userSession = $this->createStub(IUserSession::class);
		$userSession->method('getUser')->willReturn($user);

		$request = $this->createStub(IRequest::class);
		$request->method('getHeader')->with('If-Match')->willReturn('"etag-1"');

		$documents = $this->createMock(DocumentService::class);
		$documents->expects(self::once())
			->method('save')
			->with('alice', 42, self::anything(), '"etag-1"')
			->willThrowException(new FileAccessDeniedException('File 42 is not writable by alice'));

		$controller = new DocumentController('betteroffice', $request, $userSession, $documents);

		$response = $controller->save(42);

		self::assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		self::assertSame(['message' => 'Forbidden'], $response->getData());
	}

	/**
	 * What the endpoint answers when the session may not read the file at all.
	 * FileAccessService::getReadableFile() refuses it and
	 * DocumentService::read() propagates the exception, so what is left to
	 * pin is the status: 403, not the 404 a missing file gives and not a
	 * DataDisplayResponse that would leak content or mime type.
	 *
	 * The read path is the half a viewer depends on, so its refusal has to
	 * be a deliberate answer rather than an unhandled exception surfacing as
	 * a 500 that a client could mistake for a transient error.
	 */
	public function testReadAnswersForbiddenForAFileTheSessionMayNotRead(): void {
		$user = $this->createStub(IUser::class);
		$user->method('getUID')->willReturn('alice');

		$userSession = $this->createStub(IUserSession::class);
		$userSession->method('getUser')->willReturn($user);

		$request = $this->createStub(IRequest::class);

		$documents = $this->createMock(DocumentService::class);
		$documents->expects(self::once())
			->method('read')
			->with('alice', 42)
			->willThrowException(new FileAccessDeniedException('File 42 is not readable by alice'));

		$controller = new DocumentController('betteroffice', $request, $userSession, $documents);

		$response = $controller->read(42);

		self::assertInstanceOf(JSONResponse::class, $response);
		self::assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		self::assertSame(['message' => 'Forbidden'], $response->getData());
	}
}
