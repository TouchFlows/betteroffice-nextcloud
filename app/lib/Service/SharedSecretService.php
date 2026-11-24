<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

use OCA\BetterOffice\AppInfo\Application;
use OCP\IAppConfig;

/**
 * The secret shared out-of-band with the relay (PLAN.md §8.5), the same
 * "internal secret" pattern Nextcloud Talk uses for its signaling backend:
 * generated once on first use and shown on the admin settings page for the
 * admin to copy into the relay's `BETTEROFFICE_RELAY_SHARED_SECRET`.
 *
 * Generation always ends with a read-back rather than returning the value
 * just generated: `IAppConfig` has no atomic "set if absent", so two
 * near-simultaneous first calls (only possible in the narrow window right
 * after install) could each generate a different value: whichever write
 * lands last is authoritative, and reading it back -- instead of trusting
 * what this call itself generated -- is what makes every caller converge on
 * that same final value, so a token signed by one request is still
 * verifiable using what another request's generation ends up persisting.
 */
class SharedSecretService {
	private const CONFIG_KEY = 'collaboration_secret';

	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function getSecret(): string {
		if (!$this->appConfig->hasKey(Application::APP_ID, self::CONFIG_KEY, lazy: true)) {
			$this->appConfig->setValueString(
				Application::APP_ID,
				self::CONFIG_KEY,
				bin2hex(random_bytes(32)),
				lazy: true,
				sensitive: true,
			);
		}
		return $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_KEY, lazy: true);
	}

	/** Regenerating invalidates every collaboration token already issued. */
	public function regenerate(): string {
		$this->appConfig->setValueString(
			Application::APP_ID,
			self::CONFIG_KEY,
			bin2hex(random_bytes(32)),
			lazy: true,
			sensitive: true,
		);
		return $this->getSecret();
	}
}
