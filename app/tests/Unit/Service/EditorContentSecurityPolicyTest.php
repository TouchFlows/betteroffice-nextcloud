<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Service;

use OCA\BetterOffice\Service\EditorContentSecurityPolicy;
use PHPUnit\Framework\TestCase;

/**
 * Without these allowances the editor page loads and then silently gives up:
 * Nextcloud's default policy refuses the WebAssembly module and the relay
 * connection, and neither failure is visible from the server (PLAN.md §3,
 * §8.3).
 */
class EditorContentSecurityPolicyTest extends TestCase {
	public function testTheEditorMayCompileWebAssembly(): void {
		$policy = EditorContentSecurityPolicy::build('')->buildPolicy();

		self::assertStringContainsString("'wasm-unsafe-eval'", $policy);
	}

	public function testASecureRelayIsReachableOverItsSocketAndItsHttpOrigin(): void {
		$policy = EditorContentSecurityPolicy::build('wss://relay.example.test')->buildPolicy();

		self::assertStringContainsString('connect-src', $policy);
		self::assertStringContainsString('wss://relay.example.test', $policy);
		self::assertStringContainsString('https://relay.example.test', $policy);
	}

	/**
	 * An admin naturally pastes `ws://relay:8788` in development; presence is
	 * fetched over http:// on that same host and port, so both are needed.
	 */
	public function testAPlainRelayIsReachableOverItsSocketAndItsHttpOrigin(): void {
		$policy = EditorContentSecurityPolicy::build('ws://127.0.0.1:8788')->buildPolicy();

		self::assertStringContainsString('ws://127.0.0.1:8788', $policy);
		self::assertStringContainsString('http://127.0.0.1:8788', $policy);
	}

	/** A path on the relay URL must not end up in the policy: CSP matches origins. */
	public function testARelayPathIsNotPartOfTheOrigin(): void {
		$policy = EditorContentSecurityPolicy::build('https://relay.example.test/some/path')->buildPolicy();

		self::assertStringContainsString('wss://relay.example.test', $policy);
		self::assertStringNotContainsString('/some/path', $policy);
	}

	public function testWithoutARelayOnlyTheWebAssemblyAllowanceIsAdded(): void {
		$policy = EditorContentSecurityPolicy::build('')->buildPolicy();

		self::assertStringNotContainsString('ws://', $policy);
		self::assertStringNotContainsString('wss://', $policy);
	}
}
