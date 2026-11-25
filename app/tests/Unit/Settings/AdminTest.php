<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Settings;

use OCA\BetterOffice\Service\RelayConfigService;
use OCA\BetterOffice\Service\SharedSecretService;
use OCA\BetterOffice\Settings\Admin;
use OCA\BetterOffice\Settings\Section;
use PHPUnit\Framework\TestCase;

class AdminTest extends TestCase {
	public function testFormCarriesTheStoredRelayUrlAndTheSecret(): void {
		$relayConfig = $this->createStub(RelayConfigService::class);
		$relayConfig->method('getRelayUrl')->willReturn('wss://relay.example.com');
		$secret = $this->createStub(SharedSecretService::class);
		// Reading it is also what generates the secret on first visit, so an
		// admin always has a value to copy into the relay.
		$secret->method('getSecret')->willReturn('a-secret-to-copy');

		$response = (new Admin($relayConfig, $secret))->getForm();

		self::assertSame('betteroffice', $response->getApp());
		self::assertSame('settings', $response->getTemplateName());
		self::assertSame(
			['relayUrl' => 'wss://relay.example.com', 'secret' => 'a-secret-to-copy'],
			$response->getParams(),
		);
	}

	public function testFormBelongsToTheAppsOwnAdminSection(): void {
		$admin = new Admin(
			$this->createStub(RelayConfigService::class),
			$this->createStub(SharedSecretService::class),
		);

		self::assertSame(Section::ID, $admin->getSection());
	}

	public function testPriorityIsWithinTheRangeNextcloudRequires(): void {
		$admin = new Admin(
			$this->createStub(RelayConfigService::class),
			$this->createStub(SharedSecretService::class),
		);

		self::assertGreaterThanOrEqual(0, $admin->getPriority());
		self::assertLessThanOrEqual(100, $admin->getPriority());
	}
}
