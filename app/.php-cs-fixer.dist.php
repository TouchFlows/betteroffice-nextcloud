<?php

declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

$config = new Nextcloud\CodingStandard\Config();

$finder = $config->getFinder()
	->notPath('vendor')
	->notPath('js')
	->in(__DIR__);

return $config
	->setFinder($finder)
	->setCacheFile('.php-cs-fixer.cache');
