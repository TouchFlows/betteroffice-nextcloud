<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Service;

use OCA\BetterOffice\AppInfo\Application;
use OCA\BetterOffice\Service\SharedSecretService;
use OCP\IAppConfig;
use PHPUnit\Framework\TestCase;

class SharedSecretServiceTest extends TestCase {
	public function testGetSecretGeneratesAndPersistsOneWhenNoneExists(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('hasKey')->with(Application::APP_ID, 'collaboration_secret', true)->willReturn(false);
		$appConfig->expects(self::once())
			->method('setValueString')
			->with(Application::APP_ID, 'collaboration_secret', self::isString(), true, true);
		$appConfig->method('getValueString')
			->with(Application::APP_ID, 'collaboration_secret', '', true)
			->willReturn('generated-secret');

		$service = new SharedSecretService($appConfig);

		self::assertSame('generated-secret', $service->getSecret());
	}

	public function testGetSecretDoesNotRegenerateWhenOneAlreadyExists(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('hasKey')->willReturn(true);
		$appConfig->expects(self::never())->method('setValueString');
		$appConfig->method('getValueString')->willReturn('existing-secret');

		$service = new SharedSecretService($appConfig);

		self::assertSame('existing-secret', $service->getSecret());
	}

	public function testRegenerateAlwaysWritesANewSecretRegardlessOfExistingState(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('hasKey')->willReturn(true);
		$appConfig->expects(self::once())
			->method('setValueString')
			->with(Application::APP_ID, 'collaboration_secret', self::isString(), true, true);
		$appConfig->method('getValueString')->willReturn('new-secret');

		$service = new SharedSecretService($appConfig);

		self::assertSame('new-secret', $service->regenerate());
	}
}
