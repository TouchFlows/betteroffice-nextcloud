import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { translate as t } from '@nextcloud/l10n';
import { XlsxEditor } from '@betteroffice/xlsx-react';
import { initWasm } from '@betteroffice/xlsx';
import { loadDocument, saveDocument, type LoadedDocument } from './documentApi';
import { SaveStatusLine, type SaveStatus } from './saveStatus';

export interface FormatEditorProps {
	fileId: number;
	fileName: string;
	readOnly: boolean;
}

/**
 * Spreadsheet editor (Phase 4). Single-user save path only: the bytes come
 * from DocumentController, the editor serialises them, and the write goes back
 * with the ETag the bytes were loaded with. Collaboration for XLSX is a
 * separate slice because its replica wiring differs from DOCX's
 * (poc/RECONNAISSANCE.md §3: the async editor never calls
 * `collaboration.onReplica`, the host reads `api.collaboration` from
 * `onReady` instead), so wiring it in without that would silently do nothing.
 */
export function XlsxEditorApp({ fileId, fileName, readOnly }: FormatEditorProps) {
	const [document, setDocument] = useState<LoadedDocument>();
	const [loadError, setLoadError] = useState<string>();
	const [status, setStatus] = useState<SaveStatus>('idle');
	const etag = useRef('');

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				// The wasm engine is loaded explicitly rather than lazily on
				// first use, so a failure surfaces as "could not open" instead
				// of an editor that renders and then silently refuses edits.
				await initWasm();
				const loaded = await loadDocument(fileId);
				if (cancelled) {
					return;
				}
				etag.current = loaded.etag;
				setDocument(loaded);
			} catch {
				if (!cancelled) {
					setLoadError(t('betteroffice', 'Could not open this file.'));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [fileId]);

	const handleSave = useCallback(
		(bytes: Uint8Array) => {
			void (async () => {
				setStatus('saving');
				try {
					etag.current = await saveDocument(fileId, bytes, etag.current);
					setStatus('saved');
				} catch (error) {
					// 409 is the stale-ETag refusal, not a broken save (§9.3).
					setStatus(isAxiosError(error) && error.response?.status === 409 ? 'conflict' : 'error');
				}
			})();
		},
		[fileId],
	);

	if (loadError !== undefined) {
		return (
			<p className="betteroffice-save-status" role="alert">
				{loadError}
			</p>
		);
	}
	if (document === undefined) {
		return (
			<p className="betteroffice-save-status" role="status">
				{t('betteroffice', 'Opening…')}
			</p>
		);
	}

	return (
		<div className="betteroffice-format-editor">
			<h1 className="hidden-visually">{fileName}</h1>
			<SaveStatusLine status={status} />
			<div className="betteroffice-format-editor__canvas">
				<XlsxEditor file={document.bytes} readOnly={readOnly} onSave={handleSave} />
			</div>
		</div>
	);
}
