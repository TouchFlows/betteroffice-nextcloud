import { createRoot } from 'react-dom/client';
import { EditorApp } from './EditorApp';
import { PptxEditorApp } from './PptxEditorApp';
import { XlsxEditorApp } from './XlsxEditorApp';

const mount = document.getElementById('betteroffice-editor');
if (mount) {
	const fileId = Number(mount.dataset.fileId);
	const fileName = mount.dataset.fileName ?? '';
	const readOnly = mount.dataset.readOnly === '1';
	const relayUrl = mount.dataset.relayUrl ?? '';
	/**
	 * The server resolves this from the file's mime type, so the editor that
	 * mounts is decided by what the file actually is rather than by a guess
	 * from the file name. A format missing here falls back to DOCX, which is
	 * the pre-Phase-4 behaviour and cannot open the other two -- that is why
	 * the three mime types and this switch are changed together.
	 */
	const format = mount.dataset.format ?? 'docx';

	const editor = format === 'xlsx'
		? <XlsxEditorApp fileId={fileId} fileName={fileName} readOnly={readOnly} />
		: format === 'pptx'
			? <PptxEditorApp fileId={fileId} fileName={fileName} readOnly={readOnly} />
			: <EditorApp fileId={fileId} fileName={fileName} readOnly={readOnly} relayUrl={relayUrl} />;

	createRoot(mount).render(editor);
}
