import { createRoot } from 'react-dom/client';
import { EditorRoute } from './EditorRoute';

const mount = document.getElementById('betteroffice-editor');
if (mount) {
	createRoot(mount).render(
		<EditorRoute
			fileId={Number(mount.dataset.fileId)}
			fileName={mount.dataset.fileName ?? ''}
			readOnly={mount.dataset.readOnly === '1'}
			relayUrl={mount.dataset.relayUrl ?? ''}
			// Resolved server-side from the file's mime type. An unknown or
			// missing value falls through to DOCX, which is the pre-Phase-4
			// behaviour -- the mime list, this attribute and the editors are
			// changed together for exactly that reason.
			format={mount.dataset.format ?? 'docx'}
		/>,
	);
}
