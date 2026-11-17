<?php

declare(strict_types=1);

namespace OCA\BetterOffice\AppInfo;

use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;

class Application extends App implements IBootstrap {
	public const APP_ID = 'betteroffice';

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void {
		// File actions, viewer registration and the editor controller land
		// here in Phase 2 (PLAN.md §6.2).
	}

	public function boot(IBootContext $context): void {
	}
}
