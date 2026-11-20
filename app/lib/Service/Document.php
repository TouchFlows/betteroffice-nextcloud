<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

final readonly class Document {
	public function __construct(
		public string $content,
		public string $etag,
		public string $mimeType,
		public string $fileName,
	) {
	}
}
