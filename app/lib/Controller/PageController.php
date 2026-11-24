<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;

class PageController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
	) {
		parent::__construct($appName, $request);
	}

	#[NoCSRFRequired]
	#[NoAdminRequired]
	public function index(): TemplateResponse {
		// A placeholder shell for now; editor routing lands in Phase 2
		// (PLAN.md §6.2, §11).
		return new TemplateResponse('betteroffice', 'index');
	}
}
