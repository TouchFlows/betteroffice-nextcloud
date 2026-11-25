<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Controller;

use OCA\BetterOffice\Service\InvalidRelayUrlException;
use OCA\BetterOffice\Service\RelayConfigService;
use OCA\BetterOffice\Service\SharedSecretService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/**
 * The writes behind the admin settings page (`Settings\Admin`).
 *
 * Deliberately carries no `#[NoAdminRequired]`: these change instance-wide
 * configuration, so the AppFramework's default admin check is exactly right.
 * CSRF stays enforced too -- the page posts with `@nextcloud/axios`, which
 * sends the request token, the same as the editor's save path.
 */
class SettingsController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private RelayConfigService $relayConfig,
		private SharedSecretService $secret,
	) {
		parent::__construct($appName, $request);
	}

	public function saveRelayUrl(string $relayUrl = ''): JSONResponse {
		try {
			$this->relayConfig->setRelayUrl($relayUrl);
		} catch (InvalidRelayUrlException) {
			return new JSONResponse(
				['message' => 'The relay URL must be an http(s):// or ws(s):// URL, or empty to disable collaboration'],
				Http::STATUS_BAD_REQUEST,
			);
		}

		// Echo what was actually stored (trimmed, trailing slashes dropped) so
		// the page shows the value the editor will really use.
		return new JSONResponse(['relayUrl' => $this->relayConfig->getRelayUrl()]);
	}

	/**
	 * Invalidates every collaboration token already issued (PLAN.md §8.5):
	 * the relay rejects them until it is reconfigured with the new secret,
	 * which is the point -- a leaked secret can be revoked.
	 */
	public function regenerateSecret(): JSONResponse {
		return new JSONResponse(['secret' => $this->secret->regenerate()]);
	}
}
