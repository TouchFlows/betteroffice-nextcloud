import { createRoot } from 'react-dom/client';
import type { RefObject } from 'react';
import type { DocxEditorRef } from '@betteroffice/docx-react';
import { EditorApp } from '../../../src/editor/EditorApp';
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

const mount = document.getElementById('betteroffice-editor')!;
createRoot(mount).render(
	<EditorApp
		fileId={fileId}
		fileName={fileName}
		readOnly={readOnly}
		relayUrl={relayUrl}
		onEditorRef={exposeEditorRef}
	/>,
);
