<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

use OCA\BetterOffice\AppInfo\Application;
use OCP\IAppConfig;

/**
 * Reads and writes the collaboration relay's public base URL (PLAN.md §8.3,
 * §14).
 *
 * Deployment configuration, never a constant in source: an admin sets it on
 * the app's admin settings page (PLAN.md §4.A, §11). It stays readable and
 * writable through `occ config:app:set betteroffice relay_url` too, so
 * provisioning scripts keep working.
 *
 * An empty value means collaboration is not configured yet, which the
 * frontend treats as "edit without collaboration" rather than an error.
 * The value is passed through to the browser as-is (http(s):// or ws(s)://
 * are both accepted there and normalised), because that is what an admin
 * would naturally paste.
 */
class RelayConfigService {
	public const CONFIG_KEY = 'relay_url';

	/**
	 * Schemes an admin may configure. Anything else is a typo or a
	 * `javascript:`-style payload, and is refused before it reaches the
	 * browser, where it would become a connection URL.
	 */
	private const ALLOWED_SCHEMES = ['http', 'https', 'ws', 'wss'];

	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function getRelayUrl(): string {
		return trim($this->appConfig->getValueString(Application::APP_ID, self::CONFIG_KEY, '', lazy: true));
	}

	/**
	 * Stores the relay base URL an admin entered, or clears it to disable
	 * collaboration.
	 *
	 * @throws InvalidRelayUrlException when the value is neither empty nor an
	 *                                  absolute http(s):// / ws(s):// URL.
	 */
	public function setRelayUrl(string $url): void {
		$this->appConfig->setValueString(
			Application::APP_ID,
			self::CONFIG_KEY,
			self::normalise($url),
			lazy: true,
		);
	}

	/**
	 * Trims what an admin pasted (browsers and chat clients add whitespace)
	 * and drops trailing slashes, so `wss://relay.example.com/` and
	 * `wss://relay.example.com` are one stored value -- the editor's own URL
	 * builder appends its own path, and two spellings of one relay would make
	 * "did this change?" comparisons lie.
	 */
	private static function normalise(string $url): string {
		$url = trim($url);
		if ($url === '') {
			return '';
		}

		$parts = parse_url($url);
		if (
			$parts === false
			|| !isset($parts['scheme'], $parts['host'])
			|| $parts['host'] === ''
			|| !in_array(strtolower($parts['scheme']), self::ALLOWED_SCHEMES, true)
		) {
			throw new InvalidRelayUrlException($url);
		}

		return rtrim($url, '/');
	}
}
