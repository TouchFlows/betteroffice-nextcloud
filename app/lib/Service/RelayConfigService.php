<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

use OCA\BetterOffice\AppInfo\Application;
use OCP\IAppConfig;

/**
 * Reads the collaboration relay's public base URL (PLAN.md §8.3, §14).
 *
 * Deployment configuration, never a constant in source: until the admin
 * settings page (PLAN.md §4.A, §11 -- slice 4 of Phase 3) exists, an admin
 * sets it with
 *
 *     occ config:app:set betteroffice relay_url --value="wss://relay.example.com"
 *
 * An empty value means collaboration is not configured yet, which the
 * frontend treats as "edit without collaboration" rather than an error.
 * The value is passed through to the browser as-is (http(s):// or ws(s)://
 * are both accepted there and normalised), because that is what an admin
 * would naturally paste.
 */
class RelayConfigService {
	public const CONFIG_KEY = 'relay_url';

	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function getRelayUrl(): string {
		return trim($this->appConfig->getValueString(Application::APP_ID, self::CONFIG_KEY, '', lazy: true));
	}
}
