<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Settings;

use OCA\BetterOffice\Service\RelayConfigService;
use OCA\BetterOffice\Service\SharedSecretService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\Settings\ISettings;

/**
 * The app's admin settings (PLAN.md §4.A "Administration settings", §11):
 * where an admin sets the relay URL and copies the collaboration secret into
 * the relay's own configuration.
 *
 * Registered in `appinfo/info.xml`; Nextcloud builds this class through the
 * DI container, so the two services are injected rather than resolved here.
 * The form itself is the app's usual React page (`src/settings/`) posting to
 * `SettingsController` -- the same axios + CSRF path the editor's save
 * already uses, rather than a second, hand-rolled form-POST mechanism.
 */
class Admin implements ISettings {
	public function __construct(
		private RelayConfigService $relayConfig,
		private SharedSecretService $secret,
	) {
	}

	public function getForm(): TemplateResponse {
		return new TemplateResponse('betteroffice', 'settings', [
			'relayUrl' => $this->relayConfig->getRelayUrl(),
			// Generated on first read if this is the first time anyone has
			// looked (`SharedSecretService`): an admin needs a value to copy
			// into the relay from the moment they visit this page.
			'secret' => $this->secret->getSecret(),
		]);
	}

	public function getSection(): string {
		return Section::ID;
	}

	public function getPriority(): int {
		return 10;
	}
}
