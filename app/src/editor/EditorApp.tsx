import { useEffect, useState } from 'react';
import axios, { isAxiosError } from '@nextcloud/axios';
import { getCurrentUser } from '@nextcloud/auth';
import { generateUrl } from '@nextcloud/router';
import { translate as t } from '@nextcloud/l10n';
import { DocxEditor } from '@betteroffice/docx-react';
import '@betteroffice/docx-react/styles.css';

export interface EditorAppProps {
	fileId: number;
	fileName: string;
	readOnly: boolean;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

function documentUrl(fileId: number): string {
	return generateUrl('/apps/betteroffice/document/{fileId}', { fileId });
}

export function EditorApp({ fileId, fileName, readOnly }: EditorAppProps) {
	const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer>();
	const [etag, setEtag] = useState<string>();
	const [loadError, setLoadError] = useState<string>();
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

	useEffect(() => {
		let cancelled = false;
		axios
			.get<ArrayBuffer>(documentUrl(fileId), { responseType: 'arraybuffer' })
			.then((response) => {
				if (cancelled) return;
				setDocumentBuffer(response.data);
				setEtag(response.headers.etag as string);
			})
			.catch(() => {
				if (!cancelled) setLoadError(t('betteroffice', 'Could not open this document.'));
			});
		return () => {
			cancelled = true;
		};
	}, [fileId]);

	const handleSave = async (buffer: ArrayBuffer) => {
		if (!etag) return;
		setSaveStatus('saving');
		try {
			const response = await axios.put<{ etag: string }>(documentUrl(fileId), buffer, {
				headers: { 'Content-Type': 'application/octet-stream', 'If-Match': etag },
			});
			setEtag(response.data.etag);
			setSaveStatus('saved');
		} catch (error) {
			const status = isAxiosError(error) ? error.response?.status : undefined;
			setSaveStatus(status === 409 ? 'conflict' : 'error');
		}
	};

	if (loadError) {
		return <div className="betteroffice-editor-message">{loadError}</div>;
	}
	if (!documentBuffer) {
		return <div className="betteroffice-editor-message">{t('betteroffice', 'Loading…')}</div>;
	}

	return (
		<div className="betteroffice-editor">
			<SaveStatusBanner status={saveStatus} />
			<DocxEditor
				documentBuffer={documentBuffer}
				documentName={fileName}
				readOnly={readOnly}
				author={getCurrentUser()?.displayName ?? getCurrentUser()?.uid}
				downloadOnSave={false}
				onSave={(buffer) => {
					void handleSave(buffer);
				}}
			/>
		</div>
	);
}

function SaveStatusBanner({ status }: { status: SaveStatus }) {
	if (status === 'idle') return null;
	const messages: Record<Exclude<SaveStatus, 'idle'>, string> = {
		saving: t('betteroffice', 'Saving…'),
		saved: t('betteroffice', 'All changes saved'),
		conflict: t('betteroffice', 'This file was modified elsewhere. Reload the page before saving again.'),
		error: t('betteroffice', 'Save failed. Try again.'),
	};
	return <div className={`betteroffice-save-status betteroffice-save-status--${status}`}>{messages[status]}</div>;
}
