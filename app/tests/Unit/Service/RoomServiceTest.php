<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Service;

use OCA\BetterOffice\Db\Session;
use OCA\BetterOffice\Db\SessionMapper;
use OCA\BetterOffice\Service\RoomService;
use OCA\BetterOffice\Service\SharedSecretService;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DBException;
use OCP\IConfig;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

/** Throws with a specific reason: the shipped `OCP\DB\Exception` stub always returns null from getReason(). */
class ConstraintViolationException extends DBException {
	public function getReason(): ?int {
		return self::REASON_CONSTRAINT_VIOLATION;
	}
}

class RoomServiceTest extends TestCase {
	private SessionMapper $sessions;
	private SharedSecretService $secret;
	private IConfig $config;
	private ITimeFactory $time;
	private RoomService $service;

	protected function setUp(): void {
		$this->sessions = $this->createMock(SessionMapper::class);
		$this->secret = $this->createStub(SharedSecretService::class);
		$this->secret->method('getSecret')->willReturn('shared-secret');
		$this->config = $this->createStub(IConfig::class);
		$this->config->method('getSystemValue')->willReturn('instance-1');
		$this->time = $this->createStub(ITimeFactory::class);
		$this->time->method('now')->willReturn(new \DateTimeImmutable('2026-11-24T12:00:00+00:00'));
		$this->time->method('getTime')->willReturn(1_800_000_000);

		$this->service = new RoomService($this->sessions, $this->secret, $this->config, $this->time);
	}

	#[AllowMockObjectsWithoutExpectations]
	public function testComputeRoomIdIsDeterministicForTheSameIdentity(): void {
		$first = $this->service->computeRoomId('instance-1', 42, 'docx');
		$second = $this->service->computeRoomId('instance-1', 42, 'docx');

		self::assertSame($first, $second);
	}

	#[AllowMockObjectsWithoutExpectations]
	public function testComputeRoomIdDiffersForADifferentFileOrFormat(): void {
		$byFile = $this->service->computeRoomId('instance-1', 42, 'docx');
		$byOtherFile = $this->service->computeRoomId('instance-1', 43, 'docx');
		$byOtherFormat = $this->service->computeRoomId('instance-1', 42, 'xlsx');

		self::assertNotSame($byFile, $byOtherFile);
		self::assertNotSame($byFile, $byOtherFormat);
	}

	public function testResolveSessionReturnsTheExistingSessionWithoutInserting(): void {
		$existing = new Session();
		$existing->setRoomId('existing-room');
		$this->sessions->method('findByIdentity')->with('instance-1', 42, 'docx')->willReturn($existing);
		$this->sessions->expects(self::never())->method('insert');

		$session = $this->service->resolveSession(42, 'docx', '"etag-1"');

		self::assertSame('existing-room', $session->getRoomId());
	}

	public function testResolveSessionCreatesANewSessionWhenNoneExists(): void {
		$this->sessions->method('findByIdentity')->willThrowException(new DoesNotExistException('none yet'));
		$this->sessions->expects(self::once())
			->method('insert')
			->with(self::callback(function (Session $session): bool {
				self::assertSame('instance-1', $session->getInstanceId());
				self::assertSame(42, $session->getFileId());
				self::assertSame('docx', $session->getFormat());
				self::assertSame('"etag-1"', $session->getInitialEtag());
				self::assertSame('"etag-1"', $session->getSavedEtag());
				self::assertSame('active', $session->getStatus());
				self::assertSame(
					$this->service->computeRoomId('instance-1', 42, 'docx'),
					$session->getRoomId(),
				);
				return true;
			}))
			->willReturnArgument(0);

		$session = $this->service->resolveSession(42, 'docx', '"etag-1"');

		self::assertSame('"etag-1"', $session->getInitialEtag());
	}

	#[AllowMockObjectsWithoutExpectations]
	public function testResolveSessionAdoptsTheWinningRowWhenItLosesTheCreateRace(): void {
		$winner = new Session();
		$winner->setRoomId('winning-room');
		$calls = 0;
		$this->sessions->method('findByIdentity')->willReturnCallback(function () use (&$calls, $winner): Session {
			$calls++;
			if ($calls === 1) {
				throw new DoesNotExistException('none yet');
			}
			return $winner;
		});
		$this->sessions->method('insert')->willThrowException(new ConstraintViolationException('duplicate'));

		$session = $this->service->resolveSession(42, 'docx', '"etag-1"');

		self::assertSame('winning-room', $session->getRoomId());
		self::assertSame(2, $calls);
	}

	#[AllowMockObjectsWithoutExpectations]
	public function testResolveSessionDoesNotSwallowAnUnrelatedDatabaseError(): void {
		$this->sessions->method('findByIdentity')->willThrowException(new DoesNotExistException('none yet'));
		$this->sessions->method('insert')->willThrowException(new DBException('connection lost'));

		$this->expectException(DBException::class);
		$this->service->resolveSession(42, 'docx', '"etag-1"');
	}

	#[AllowMockObjectsWithoutExpectations]
	public function testIssueTokenProducesAVerifiableHs256Token(): void {
		$session = new Session();
		$session->setInstanceId('instance-1');
		$session->setFileId(42);
		$session->setFormat('docx');
		$session->setRoomId('room-abc');

		$token = $this->service->issueToken($session, 'alice', 'write');

		[$header, $payload, $signature] = explode('.', $token);
		$decode = static fn (string $segment) => base64_decode(strtr($segment, '-_', '+/'), true);

		$expectedSignature = rtrim(
			strtr(base64_encode(hash_hmac('sha256', "{$header}.{$payload}", 'shared-secret', true)), '+/', '-_'),
			'=',
		);
		self::assertSame($expectedSignature, $signature);

		$claims = json_decode($decode($payload), true, flags: JSON_THROW_ON_ERROR);
		self::assertSame('instance-1', $claims['iid']);
		self::assertSame('alice', $claims['sub']);
		self::assertSame(42, $claims['fid']);
		self::assertSame('room-abc', $claims['roomId']);
		self::assertSame('docx', $claims['format']);
		self::assertSame('write', $claims['role']);
		self::assertSame(1_800_000_300, $claims['exp']);
		self::assertNotEmpty($claims['jti']);
	}

	#[AllowMockObjectsWithoutExpectations]
	public function testResolveSeedReturnsTheOfferedSeedWhenItWinsTheRace(): void {
		$session = Session::fromRow(['id' => 7, 'instance_id' => 'instance-1', 'file_id' => 42, 'format' => 'docx']);
		$this->sessions->method('trySetSeed')->with(7, 'my-seed-bytes')->willReturn(true);
		$this->sessions->expects(self::never())->method('findByIdentity');

		self::assertSame('my-seed-bytes', $this->service->resolveSeed($session, 'my-seed-bytes'));
	}

	#[AllowMockObjectsWithoutExpectations]
	public function testResolveSeedAdoptsTheAuthoritativeSeedWhenItLosesTheRace(): void {
		$session = Session::fromRow(['id' => 7, 'instance_id' => 'instance-1', 'file_id' => 42, 'format' => 'docx']);
		$winner = Session::fromRow(['id' => 7, 'seed' => 'winning-seed-bytes']);
		$this->sessions->method('trySetSeed')->willReturn(false);
		$this->sessions->method('findByIdentity')->with('instance-1', 42, 'docx')->willReturn($winner);

		self::assertSame('winning-seed-bytes', $this->service->resolveSeed($session, 'my-seed-bytes'));
	}

	#[AllowMockObjectsWithoutExpectations]
	public function testResolveSeedThrowsIfItLostTheRaceButNoSeedIsOnRecordEither(): void {
		$session = Session::fromRow(['id' => 7, 'instance_id' => 'instance-1', 'file_id' => 42, 'format' => 'docx']);
		$inconsistent = Session::fromRow(['id' => 7, 'seed' => null]);
		$this->sessions->method('trySetSeed')->willReturn(false);
		$this->sessions->method('findByIdentity')->willReturn($inconsistent);

		$this->expectException(\RuntimeException::class);
		$this->service->resolveSeed($session, 'my-seed-bytes');
	}
}
