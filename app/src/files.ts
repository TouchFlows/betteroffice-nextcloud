import { registerFileAction, DefaultType } from '@nextcloud/files';
import { translate as t } from '@nextcloud/l10n';
import { generateUrl } from '@nextcloud/router';

/**
 * DOCX only for now -- XLSX/PPTX actions join once their editors are wired
 * (Phase 4). Registering an action for a format we can't open yet would be
 * a broken "Open with BetterOffice" entry (PLAN.md §6.2 explicitly wants a
 * reliable explicit action).
 */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="#fff" d="M4 2h9l3 3v13H4zm9 1.2V6h2.8z"/><path fill="#fff" d="M6 9h8v1.5H6zm0 3h8v1.5H6zm0 3h5v1.5H6z"/></svg>';

registerFileAction({
	id: 'betteroffice-open',
	displayName: () => t('betteroffice', 'Open with BetterOffice'),
	iconSvgInline: () => ICON,
	enabled: (context) => context.nodes.every((node) => node.mime === DOCX_MIME),
	// Marking this the default action also gives DOCX files native
	// double-click opening (PLAN.md §6.2) without a separate Viewer
	// registration -- investigated and not needed for that requirement.
	default: DefaultType.DEFAULT,
	order: -100,
	async exec(context) {
		const [node] = context.nodes;
		if (node.fileid === undefined) {
			return false;
		}
		window.location.href = generateUrl('/apps/betteroffice/editor/{fileId}', { fileId: node.fileid });
		return true;
	},
});
