import { createRoot } from 'react-dom/client';
import { EditorApp } from './EditorApp';

const mount = document.getElementById('betteroffice-editor');
if (mount) {
	const fileId = Number(mount.dataset.fileId);
	const fileName = mount.dataset.fileName ?? '';
	const readOnly = mount.dataset.readOnly === '1';
	createRoot(mount).render(<EditorApp fileId={fileId} fileName={fileName} readOnly={readOnly} />);
}
