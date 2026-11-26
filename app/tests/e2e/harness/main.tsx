import { createRoot } from 'react-dom/client';
import type { RefObject } from 'react';
import type { DocxEditorRef } from '@betteroffice/docx-react';
import { EditorRoute } from '../../../src/editor/EditorRoute';
import '../../../css/style.css';

// @nextcloud/router's generateUrl needs this; everything else it reads
// (window.OC, _oc_appswebroots) is irrelevant to the /apps/.../ paths this
// harness exercises.
(window as unknown as { _oc_webroot: string })._oc_webroot = '';

declare global {
	interface Window {
		__betteroffice?: { editorRef?: RefObject<DocxEditorRef | null> };
	}
}

// A stable identity: EditorApp calls this from an effect keyed on the
// callback, so a fresh closure per render would re-run it every render.
function exposeEditorRef(editorRef: RefObject<DocxEditorRef | null>): void {
	window.__betteroffice = { editorRef };
}

const params = new URLSearchParams(window.location.search);
const fileId = Number(params.get('fileId') ?? '1');
const fileName = params.get('fileName') ?? 'demo.docx';
const readOnly = params.get('readOnly') === '1';
const relayUrl = params.get('relayUrl') ?? '';
// Mirrors the `data-format` attribute EditorController renders, so the
// harness exercises the same dispatch the real page does.
const format = params.get('format') ?? 'docx';

const mount = document.getElementById('betteroffice-editor')!;
createRoot(mount).render(
	<EditorRoute
		fileId={fileId}
		fileName={fileName}
		readOnly={readOnly}
		relayUrl={relayUrl}
		format={format}
		onEditorRef={exposeEditorRef}
	/>,
);
