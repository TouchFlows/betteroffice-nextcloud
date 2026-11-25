<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

use OCP\AppFramework\Http\ContentSecurityPolicy;

/**
 * The Content-Security-Policy the editor page needs (PLAN.md §3, §8.3).
 *
 * Nextcloud's default policy refuses the two things this editor cannot run
 * without, and a CSP violation is invisible from the server: the browser
 * simply fails to compile the module, the editor falls back to "editing on
 * your own", and nothing in the app's logs says why.
 *
 * - WebAssembly compilation: every BetterOffice editor is a WebAssembly
 *   module, and `wasm-unsafe-eval` is the one directive that permits
 *   compiling it without allowing arbitrary `eval`. Core's own
 *   `files_pdfviewer` makes the same allowance for pdf.js.
 * - The configured relay's origin in `connect-src`: the collaboration socket
 *   and the presence roster live on the relay, not on Nextcloud, and the
 *   default `connect-src 'self'` blocks both.
 *
 * The relay origin is added in both spellings, because a CSP origin is
 * scheme-specific: the socket uses `ws(s)://` while presence is fetched over
 * `http(s)://`. Only scheme, host and port matter to CSP, so any path on the
 * configured URL is dropped.
 */
final class EditorContentSecurityPolicy {
	public static function build(string $relayUrl): ContentSecurityPolicy {
		$policy = new ContentSecurityPolicy();
		$policy->allowEvalWasm();

		foreach (self::relayOrigins($relayUrl) as $origin) {
			$policy->addAllowedConnectDomain($origin);
		}

		return $policy;
	}

	/**
	 * @return list<string> both spellings of the relay's origin, or nothing
	 *                      when collaboration is not configured (or the value
	 *                      is not an absolute URL, which `RelayConfigService`
	 *                      already refuses to store)
	 */
	private static function relayOrigins(string $relayUrl): array {
		if ($relayUrl === '') {
			return [];
		}

		$parts = parse_url($relayUrl);
		if ($parts === false || !isset($parts['scheme'], $parts['host'])) {
			return [];
		}

		$origin = $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
		$secure = in_array(strtolower($parts['scheme']), ['https', 'wss'], true);

		return [
			($secure ? 'https' : 'http') . '://' . $origin,
			($secure ? 'wss' : 'ws') . '://' . $origin,
		];
	}
}
