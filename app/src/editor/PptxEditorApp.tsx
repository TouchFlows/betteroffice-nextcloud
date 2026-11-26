import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { translate as t } from '@nextcloud/l10n';
import { PptxEditor, type PptxAsyncEditorApi } from '@betteroffice/pptx-react';
import { initWasm } from '@betteroffice/pptx';
import { loadDocument, saveDocument, type LoadedDocument } from './documentApi';
import { SaveStatusLine, type SaveStatus } from './saveStatus';
import type { FormatEditorProps } from './XlsxEditorApp';

/**
 * Presentation editor (Phase 4). Single-user save path only, same shape as
 * the spreadsheet editor; the presentation package's collaboration provider
 * takes an `AsyncCollaborationReplica` directly (no
 * `createAsyncCollaborationReplica` exists for PPTX), which is why wiring
 * collaboration is its own slice rather than a copy of XLSX's.
 *
 * `fonts` is mandatory on `PptxEditor` even without collaboration, and an
 * empty list is the documented default rather than an omission
 * (poc/RECONNAISSANCE.md §3).
 */
export interface PptxEditorAppProps extends FormatEditorProps {
	/**
	 * Hands the live editor API to an embedding host. The e2e harness uses it
	 * to read the deck's text, which is painted to canvas and therefore has no
	 * DOM to query; production code has no need for it.
	 */
	onReady?: (api: PptxAsyncEditorApi) => void;
}

export function PptxEditorApp({ fileId, fileName, readOnly, onReady }: PptxEditorAppProps) {
	const [document, setDocument] = useState<LoadedDocument>();
	const [loadError, setLoadError] = useState<string>();
	const [status, setStatus] = useState<SaveStatus>('idle');
	const etag = useRef('');

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
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
				<PptxEditor file={document.bytes} fonts={[]} readOnly={readOnly} onSave={handleSave} onReady={onReady} />
			</div>
		</div>
	);
}
