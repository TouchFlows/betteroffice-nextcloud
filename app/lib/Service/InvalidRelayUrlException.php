<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

/**
 * Thrown when an admin enters something that is neither empty (collaboration
 * disabled) nor an absolute http(s):// / ws(s):// URL with a host -- a typo
 * that would otherwise be persisted and break every editor's connection
 * attempt instead of being caught on the settings page (PLAN.md §14).
 */
class InvalidRelayUrlException extends \InvalidArgumentException {
	public function __construct(string $url) {
		parent::__construct("Not an absolute http(s):// or ws(s):// URL: {$url}");
	}
}
