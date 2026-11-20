<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Service;

/** No node with that ID exists in the requesting user's own folder -- deliberately indistinguishable from "exists but not yours" (PLAN.md §6.3). */
class FileNotFoundException extends FileAccessException {
}
