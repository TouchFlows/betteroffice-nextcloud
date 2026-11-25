<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Controller;

use OCA\BetterOffice\Controller\SettingsController;
use OCA\BetterOffice\Service\RelayConfigService;
use OCA\BetterOffice\Service\SharedSecretService;
use OCP\AppFramework\Http;
use OCP\IAppConfig;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

class SettingsControllerTest extends TestCase {
	public function testSaveRelayUrlStoresItAndEchoesWhatWasStored(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects(self::once())
			->method('setValueString')
			->with('betteroffice', 'relay_url', 'wss://relay.example.com', true)
			->willReturn(true);
		$appConfig->method('getValueString')->willReturn('wss://relay.example.com');

		$response = $this->controller($appConfig)->saveRelayUrl('wss://relay.example.com/');

		self::assertSame(Http::STATUS_OK, $response->getStatus());
		self::assertSame(['relayUrl' => 'wss://relay.example.com'], $response->getData());
	}

	public function testSaveRelayUrlRefusesAnInvalidUrlWithoutStoringIt(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects(self::never())->method('setValueString');

		$response = $this->controller($appConfig)->saveRelayUrl('relay.example.com');

		self::assertSame(Http::STATUS_BAD_REQUEST, $response->getStatus());
		self::assertArrayHasKey('message', $response->getData());
	}

	public function testSaveRelayUrlCanDisableCollaboration(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects(self::once())
			->method('setValueString')
			->with('betteroffice', 'relay_url', '', true)
			->willReturn(true);
		$appConfig->method('getValueString')->willReturn('');

		$response = $this->controller($appConfig)->saveRelayUrl('');

		self::assertSame(Http::STATUS_OK, $response->getStatus());
		self::assertSame(['relayUrl' => ''], $response->getData());
	}

	public function testRegenerateSecretReturnsTheNewSecret(): void {
		$secret = $this->createMock(SharedSecretService::class);
		$secret->expects(self::once())->method('regenerate')->willReturn('the-new-secret');

		$response = $this->controller(
			$this->createStub(IAppConfig::class),
			$secret,
		)->regenerateSecret();

		self::assertSame(Http::STATUS_OK, $response->getStatus());
		self::assertSame(['secret' => 'the-new-secret'], $response->getData());
	}

	private function controller(
		IAppConfig $appConfig,
		?SharedSecretService $secret = null,
	): SettingsController {
		return new SettingsController(
			'betteroffice',
			$this->createStub(IRequest::class),
			new RelayConfigService($appConfig),
			$secret ?? $this->createStub(SharedSecretService::class),
		);
	}
}
