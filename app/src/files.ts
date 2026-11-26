import { registerFileAction, DefaultType } from '@nextcloud/files';
import { translate as t } from '@nextcloud/l10n';
import { generateUrl } from '@nextcloud/router';

/**
 * Every format the editor route can actually open. This list and the editors
 * behind the route are changed together: an action registered for a format
 * the editor cannot render would be a broken "Open with BetterOffice" entry
 * (PLAN.md §6.2 explicitly wants a reliable explicit action).
 */
const SUPPORTED_MIMES = new Set([
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="#fff" d="M4 2h9l3 3v13H4zm9 1.2V6h2.8z"/><path fill="#fff" d="M6 9h8v1.5H6zm0 3h8v1.5H6zm0 3h5v1.5H6z"/></svg>';

registerFileAction({
	id: 'betteroffice-open',
	displayName: () => t('betteroffice', 'Open with BetterOffice'),
	iconSvgInline: () => ICON,
	enabled: (context) => context.nodes.every((node) => SUPPORTED_MIMES.has(node.mime)),
	// Marking this the default action also gives these documents native
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
