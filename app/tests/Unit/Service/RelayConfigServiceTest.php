<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Service;

use OCA\BetterOffice\Service\RelayConfigService;
use OCP\IAppConfig;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

class RelayConfigServiceTest extends TestCase {
	public function testReturnsTheConfiguredRelayUrl(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects(self::once())
			->method('getValueString')
			->with('betteroffice', 'relay_url', '', true)
			->willReturn('wss://relay.example.com');

		$service = new RelayConfigService($appConfig);

		self::assertSame('wss://relay.example.com', $service->getRelayUrl());
	}

	#[AllowMockObjectsWithoutExpectations]
	public function testTrimsSurroundingWhitespace(): void {
		$appConfig = $this->createStub(IAppConfig::class);
		$appConfig->method('getValueString')->willReturn("  https://relay.example.com\n");

		$service = new RelayConfigService($appConfig);

		self::assertSame('https://relay.example.com', $service->getRelayUrl());
	}

	#[AllowMockObjectsWithoutExpectations]
	public function testReturnsAnEmptyStringWhenNothingIsConfigured(): void {
		$appConfig = $this->createStub(IAppConfig::class);
		$appConfig->method('getValueString')->willReturn('');

		$service = new RelayConfigService($appConfig);

		// Empty means "collaboration not configured yet" -- the editor falls
		// back to editing without collaboration instead of failing.
		self::assertSame('', $service->getRelayUrl());
	}
}
