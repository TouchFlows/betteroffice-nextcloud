<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Controller;

use OCA\BetterOffice\Controller\CollaborationController;
use OCA\BetterOffice\Db\Session;
use OCA\BetterOffice\Service\FileAccessService;
use OCA\BetterOffice\Service\RoomService;
use OCP\AppFramework\Http;
use OCP\Files\File;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\TestCase;

class CollaborationControllerTest extends TestCase {
	/**
	 * Presence (PLAN.md §8.6) is only trustworthy if the identity in the token
	 * comes from the authenticated Nextcloud user, so the token -- not the
	 * browser -- is what the relay reports to other participants.
	 */
	public function testSessionSignsTheUsersDisplayNameAndAvatarIntoTheToken(): void {
		$user = $this->createStub(IUser::class);
		$user->method('getUID')->willReturn('alice');
		$user->method('getDisplayName')->willReturn('Alice Anderson');

		$userSession = $this->createStub(IUserSession::class);
		$userSession->method('getUser')->willReturn($user);

		$file = $this->createStub(File::class);
		$file->method('getEtag')->willReturn('"etag-1"');
		$file->method('isUpdateable')->willReturn(true);

		$fileAccess = $this->createStub(FileAccessService::class);
		$fileAccess->method('getReadableFile')->willReturn($file);

		$session = new Session();
		$session->setRoomId('room-1');

		$urlGenerator = $this->createMock(IURLGenerator::class);
		$urlGenerator->expects(self::once())
			->method('linkToRouteAbsolute')
			->with('core.Avatar.getAvatar', ['userId' => 'alice', 'size' => 64])
			->willReturn('https://cloud.example.test/index.php/avatar/alice/64');

		$rooms = $this->createMock(RoomService::class);
		$rooms->method('resolveSession')->willReturn($session);
		$rooms->expects(self::once())
			->method('issueToken')
			->with(
				$session,
				'alice',
				'write',
				'Alice Anderson',
				'https://cloud.example.test/index.php/avatar/alice/64',
			)
			->willReturn('signed-token');

		$controller = new CollaborationController(
			'betteroffice',
			$this->createStub(IRequest::class),
			$userSession,
			$fileAccess,
			$rooms,
			$urlGenerator,
		);

		$response = $controller->session(1);

		self::assertSame(Http::STATUS_OK, $response->getStatus());
		self::assertSame('signed-token', $response->getData()['token']);
		self::assertSame('room-1', $response->getData()['roomId']);
		self::assertSame('write', $response->getData()['role']);
	}

	public function testSessionRefusesAnUnauthenticatedCallerBeforeTouchingTheFile(): void {
		$userSession = $this->createStub(IUserSession::class);
		$userSession->method('getUser')->willReturn(null);

		$rooms = $this->createMock(RoomService::class);
		$rooms->expects(self::never())->method('issueToken');

		$controller = new CollaborationController(
			'betteroffice',
			$this->createStub(IRequest::class),
			$userSession,
			$this->createStub(FileAccessService::class),
			$rooms,
			$this->createStub(IURLGenerator::class),
		);

		$response = $controller->session(1);

		self::assertSame(Http::STATUS_UNAUTHORIZED, $response->getStatus());
	}
}
