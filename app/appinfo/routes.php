<?php

declare(strict_types=1);

return [
	'routes' => [
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
		['name' => 'editor#open', 'url' => '/editor/{fileId}', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		['name' => 'document#read', 'url' => '/document/{fileId}', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		['name' => 'document#save', 'url' => '/document/{fileId}', 'verb' => 'PUT', 'requirements' => ['fileId' => '\d+']],
	],
];
