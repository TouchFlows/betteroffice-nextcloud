import { translate as t } from '@nextcloud/l10n';

/** The save states all three editors report in the same terms. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

/**
 * Status line for the spreadsheet and presentation editors. DOCX renders its
 * own richer toolbar/status UI; these two keep the same five states and the
 * same wording so a user sees one vocabulary across formats.
 */
export function SaveStatusLine({ status }: { status: SaveStatus }) {
	const text = {
		idle: '',
		saving: t('betteroffice', 'Saving…'),
		saved: t('betteroffice', 'Saved'),
		conflict: t('betteroffice', 'This file changed on the server. Reload before saving again.'),
		error: t('betteroffice', 'Could not save this file.'),
	}[status];

	if (text === '') {
		return null;
	}

	const modifier = status === 'conflict' || status === 'error' ? ` betteroffice-save-status--${status}` : '';

	return (
		<p className={`betteroffice-save-status${modifier}`} role="status">
			{text}
		</p>
	);
}
