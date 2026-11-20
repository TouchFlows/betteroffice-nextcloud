<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Controller;

use OCA\BetterOffice\Service\DocumentService;
use OCA\BetterOffice\Service\FileAccessDeniedException;
use OCA\BetterOffice\Service\FileNotFoundException;
use OCA\BetterOffice\Service\FileTooLargeException;
use OCA\BetterOffice\Service\StaleEtagException;
use OCA\BetterOffice\Service\UnsupportedFileTypeException;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use OCP\IUserSession;

class DocumentController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private DocumentService $documentService,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function read(int $fileId): DataDisplayResponse|JSONResponse {
		$userId = $this->userSession->getUser()?->getUID();
		if ($userId === null) {
			return new JSONResponse(['message' => 'Not authenticated'], Http::STATUS_UNAUTHORIZED);
		}

		try {
			$document = $this->documentService->read($userId, $fileId);
		} catch (FileNotFoundException) {
			return new JSONResponse(['message' => 'Not found'], Http::STATUS_NOT_FOUND);
		} catch (FileAccessDeniedException) {
			return new JSONResponse(['message' => 'Forbidden'], Http::STATUS_FORBIDDEN);
		} catch (UnsupportedFileTypeException) {
			return new JSONResponse(['message' => 'Unsupported file type'], Http::STATUS_UNSUPPORTED_MEDIA_TYPE);
		} catch (FileTooLargeException) {
			return new JSONResponse(['message' => 'File too large'], Http::STATUS_REQUEST_ENTITY_TOO_LARGE);
		}

		$response = new DataDisplayResponse($document->content, Http::STATUS_OK, [
			'Content-Type' => $document->mimeType,
		]);
		$response->addHeader('Etag', $document->etag);
		return $response;
	}

	#[NoAdminRequired]
	public function save(int $fileId): JSONResponse {
		$userId = $this->userSession->getUser()?->getUID();
		if ($userId === null) {
			return new JSONResponse(['message' => 'Not authenticated'], Http::STATUS_UNAUTHORIZED);
		}

		$expectedEtag = $this->request->getHeader('If-Match');
		if ($expectedEtag === '') {
			return new JSONResponse(['message' => 'If-Match header is required'], Http::STATUS_BAD_REQUEST);
		}

		$content = file_get_contents('php://input');
		if ($content === false) {
			return new JSONResponse(['message' => 'Could not read request body'], Http::STATUS_BAD_REQUEST);
		}

		try {
			$etag = $this->documentService->save($userId, $fileId, $content, $expectedEtag);
		} catch (StaleEtagException) {
			return new JSONResponse(['message' => 'The file was modified since it was opened'], Http::STATUS_CONFLICT);
		} catch (FileNotFoundException) {
			return new JSONResponse(['message' => 'Not found'], Http::STATUS_NOT_FOUND);
		} catch (FileAccessDeniedException) {
			return new JSONResponse(['message' => 'Forbidden'], Http::STATUS_FORBIDDEN);
		} catch (UnsupportedFileTypeException) {
			return new JSONResponse(['message' => 'Unsupported file type'], Http::STATUS_UNSUPPORTED_MEDIA_TYPE);
		} catch (FileTooLargeException) {
			return new JSONResponse(['message' => 'File too large'], Http::STATUS_REQUEST_ENTITY_TOO_LARGE);
		}

		return new JSONResponse(['etag' => $etag]);
	}
}
