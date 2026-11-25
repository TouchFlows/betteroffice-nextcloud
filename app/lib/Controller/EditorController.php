<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Controller;

use OCA\BetterOffice\Service\FileAccessDeniedException;
use OCA\BetterOffice\Service\FileAccessService;
use OCA\BetterOffice\Service\FileNotFoundException;
use OCA\BetterOffice\Service\FileTooLargeException;
use OCA\BetterOffice\Service\RelayConfigService;
use OCA\BetterOffice\Service\UnsupportedFileTypeException;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\Util;

class EditorController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private FileAccessService $fileAccess,
		private RelayConfigService $relayConfig,
	) {
		parent::__construct($appName, $request);
	}

	// Reached by a plain top-level navigation (the Files action does
	// `window.location.href = ...`), which carries no CSRF token -- same
	// reasoning as the canonical nextcloud/app_template PageController.
	#[NoCSRFRequired]
	#[NoAdminRequired]
	public function open(int $fileId): TemplateResponse {
		$userId = $this->userSession->getUser()?->getUID();
		if ($userId === null) {
			return $this->errorResponse('Not authenticated', Http::STATUS_UNAUTHORIZED);
		}

		try {
			$file = $this->fileAccess->getReadableFile($userId, $fileId);
		} catch (FileNotFoundException) {
			return $this->errorResponse('File not found', Http::STATUS_NOT_FOUND);
		} catch (FileAccessDeniedException) {
			return $this->errorResponse('You do not have access to this file', Http::STATUS_FORBIDDEN);
		} catch (UnsupportedFileTypeException) {
			return $this->errorResponse('BetterOffice does not support this file type', Http::STATUS_UNSUPPORTED_MEDIA_TYPE);
		} catch (FileTooLargeException) {
			return $this->errorResponse('This file is too large to open', Http::STATUS_REQUEST_ENTITY_TOO_LARGE);
		}

		// @nextcloud/vite-config names the built chunk "betteroffice-editor.mjs" --
		// JSResourceLocator looks for the exact filename passed, app-id prefix included.
		Util::addScript('betteroffice', 'betteroffice-editor');
		Util::addStyle('betteroffice', 'style');

		return new TemplateResponse('betteroffice', 'editor', [
			'fileId' => $fileId,
			'fileName' => $file->getName(),
			'readOnly' => !$file->isUpdateable(),
			// Deployment configuration, not a constant (PLAN.md §14); empty
			// until an admin sets it, which the frontend reads as "no
			// collaboration configured" rather than an error.
			'relayUrl' => $this->relayConfig->getRelayUrl(),
		]);
	}

	private function errorResponse(string $message, int $status): TemplateResponse {
		return new TemplateResponse(
			$this->appName,
			'error',
			['message' => $message],
			TemplateResponse::RENDER_AS_ERROR,
			$status,
		);
	}
}
