<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Service;

use OCA\BetterOffice\Service\InvalidRelayUrlException;
use OCA\BetterOffice\Service\RelayConfigService;
use OCP\IAppConfig;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\Attributes\DataProvider;
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

	public function testSetRelayUrlStoresTheTrimmedValue(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects(self::once())
			->method('setValueString')
			->with('betteroffice', 'relay_url', 'wss://relay.example.com', true)
			->willReturn(true);

		(new RelayConfigService($appConfig))->setRelayUrl("  wss://relay.example.com\n");
	}

	/**
	 * The editor appends its own path to this value, so one relay must have
	 * exactly one stored spelling -- otherwise the settings page keeps
	 * reporting an unsaved change for a value that is already stored.
	 */
	public function testSetRelayUrlDropsTrailingSlashes(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects(self::once())
			->method('setValueString')
			->with('betteroffice', 'relay_url', 'wss://relay.example.com/relay', true)
			->willReturn(true);

		(new RelayConfigService($appConfig))->setRelayUrl('wss://relay.example.com/relay//');
	}

	/**
	 * An admin pasting the URL they browse the relay with is the common case,
	 * so http(s) is as valid as ws(s) (the frontend converts before dialling).
	 */
	#[DataProvider('validUrls')]
	public function testSetRelayUrlAcceptsEveryDocumentedScheme(string $url): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects(self::once())
			->method('setValueString')
			->with('betteroffice', 'relay_url', $url, true)
			->willReturn(true);

		(new RelayConfigService($appConfig))->setRelayUrl($url);
	}

	public static function validUrls(): array {
		return [
			'wss' => ['wss://relay.example.com'],
			'ws' => ['ws://relay.example.com:8788'],
			'https' => ['https://relay.example.com'],
			'http' => ['http://relay.example.com/relay'],
		];
	}

	public function testSetRelayUrlAcceptsAnEmptyValueToDisableCollaboration(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects(self::once())
			->method('setValueString')
			->with('betteroffice', 'relay_url', '', true)
			->willReturn(true);

		(new RelayConfigService($appConfig))->setRelayUrl('   ');
	}

	#[DataProvider('invalidUrls')]
	public function testSetRelayUrlRefusesAnythingThatIsNotAnAbsoluteHttpOrWsUrl(string $url): void {
		$appConfig = $this->createMock(IAppConfig::class);
		// Never persisted: a typo would otherwise silently break every
		// editor's connection attempt instead of being caught here.
		$appConfig->expects(self::never())->method('setValueString');

		$this->expectException(InvalidRelayUrlException::class);

		(new RelayConfigService($appConfig))->setRelayUrl($url);
	}

	public static function invalidUrls(): array {
		return [
			'missing scheme' => ['relay.example.com'],
			'unsupported scheme' => ['ftp://relay.example.com'],
			'script scheme' => ['javascript:alert(1)'],
			'missing host' => ['https://'],
			'relative path' => ['/relay'],
		];
	}
}
