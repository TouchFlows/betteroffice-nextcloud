import type { RefObject } from 'react';
import type { DocxEditorRef } from '@betteroffice/docx-react';
import { EditorApp } from './EditorApp';
import { PptxEditorApp, type PptxEditorAppProps } from './PptxEditorApp';
import { XlsxEditorApp } from './XlsxEditorApp';

export interface EditorRouteProps {
	fileId: number;
	fileName: string;
	readOnly: boolean;
	/** Relay base URL; empty means collaboration is not configured. */
	relayUrl?: string;
	/** Resolved server-side from the file's mime type (`FileAccessService::formatForMimeType`). */
	format: string;
	/**
	 * Only the DOCX editor exposes an imperative handle, so this is only
	 * honoured on that branch. The e2e harness uses it; production does not.
	 */
	onEditorRef?: (ref: RefObject<DocxEditorRef | null>) => void;
	/** Same harness-only hook for the presentation editor's API. */
	onPptxReady?: PptxEditorAppProps['onReady'];
}

/**
 * Which editor mounts is decided by what the file actually is, not by its
 * name or the URL: the server resolves the format from the mime type and the
 * page hands it down. Shared by the real entry point and the e2e harness so
 * the harness tests this dispatch rather than a second copy of it.
 */
export function EditorRoute({
	fileId,
	fileName,
	readOnly,
	relayUrl = '',
	format,
	onEditorRef,
	onPptxReady,
}: EditorRouteProps) {
	if (format === 'xlsx') {
		return <XlsxEditorApp fileId={fileId} fileName={fileName} readOnly={readOnly} />;
	}
	if (format === 'pptx') {
		return <PptxEditorApp fileId={fileId} fileName={fileName} readOnly={readOnly} onReady={onPptxReady} />;
	}
	return (
		<EditorApp
			fileId={fileId}
			fileName={fileName}
			readOnly={readOnly}
			relayUrl={relayUrl}
			onEditorRef={onEditorRef}
		/>
	);
}
