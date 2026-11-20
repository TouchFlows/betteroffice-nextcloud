<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

/** The file changed since the caller last read its ETag (PLAN.md §9.3 step 6). */
class StaleEtagException extends FileAccessException {
}
