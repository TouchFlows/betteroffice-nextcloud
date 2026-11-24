<?php

declare(strict_types=1);

return [
	'routes' => [
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
		['name' => 'editor#open', 'url' => '/editor/{fileId}', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		['name' => 'document#read', 'url' => '/document/{fileId}', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		['name' => 'document#save', 'url' => '/document/{fileId}', 'verb' => 'PUT', 'requirements' => ['fileId' => '\d+']],
		['name' => 'collaboration#session', 'url' => '/collab/session/{fileId}', 'verb' => 'POST', 'requirements' => ['fileId' => '\d+']],
		['name' => 'collaboration#seed', 'url' => '/collab/session/{fileId}/seed', 'verb' => 'PUT', 'requirements' => ['fileId' => '\d+']],
	],
];
