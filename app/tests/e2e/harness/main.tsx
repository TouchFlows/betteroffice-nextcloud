import { createRoot } from 'react-dom/client';
import { EditorApp } from '../../../src/editor/EditorApp';
import '../../../css/style.css';

// @nextcloud/router's generateUrl needs this; everything else it reads
// (window.OC, _oc_appswebroots) is irrelevant to the /apps/.../document/{id}
// path this harness exercises.
(window as unknown as { _oc_webroot: string })._oc_webroot = '';

const params = new URLSearchParams(window.location.search);
const fileId = Number(params.get('fileId') ?? '1');
const fileName = params.get('fileName') ?? 'demo.docx';
const readOnly = params.get('readOnly') === '1';

const mount = document.getElementById('betteroffice-editor')!;
createRoot(mount).render(<EditorApp fileId={fileId} fileName={fileName} readOnly={readOnly} />);
