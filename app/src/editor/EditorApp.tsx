import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import axios, { isAxiosError } from '@nextcloud/axios';
import { getCurrentUser } from '@nextcloud/auth';
import { generateUrl } from '@nextcloud/router';
import { translate as t } from '@nextcloud/l10n';
import { DocxEditor, type DocxEditorRef } from '@betteroffice/docx-react';
import '@betteroffice/docx-react/styles.css';
import {
	CollaborationProvider,
	type CollaborationReplica,
	type CollaborationStatus,
} from '@betteroffice/docx/collaboration';
import { WsCollaborationTransport } from './collaboration/transport';
import {
	relaySocketUrl,
	requestCollaborationSession,
	resolveInitialUpdate,
	type CollaborationSession,
} from './collaboration/session';

export interface EditorAppProps {
	fileId: number;
	fileName: string;
	readOnly: boolean;
	/** Relay base URL from the server (`data-relay-url`); empty means collaboration is not configured. */
	relayUrl?: string;
	/**
	 * Hands the live editor handle to an embedding host. The e2e harness uses
	 * it to read and edit the document directly; production code has no need
	 * for it.
	 */
	onEditorRef?: (ref: RefObject<DocxEditorRef | null>) => void;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

type CollaborationState =
	| { phase: 'disabled' }
	| { phase: 'preparing' }
	| { phase: 'live'; status: CollaborationStatus; synced: boolean; peers: number }
	| { phase: 'failed' };

/**
 * Backoff for reconnecting after the relay drops the socket, capped rather
 * than giving up: a relay restart or a laptop waking up should heal on its
 * own without the user reloading.
 */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000];

function documentUrl(fileId: number): string {
	return generateUrl('/apps/betteroffice/document/{fileId}', { fileId });
}

export function EditorApp({ fileId, fileName, readOnly, relayUrl = '', onEditorRef }: EditorAppProps) {
	const editorRef = useRef<DocxEditorRef>(null);
	const providerRef = useRef<CollaborationProvider | null>(null);
	const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectAttempts = useRef(0);
	/**
	 * The session the seed handshake resolved, kept for the provider's first
	 * connection. Opening a document resolves a session once already; asking
	 * for a second one moments later only to open the socket is a redundant
	 * round trip (and a second seed lookup). It is consumed by the first
	 * connection attempt and never reused after that: a reconnect may come
	 * long after the token's five-minute lifetime.
	 */
	const initialTokenRef = useRef<{ roomId: string; token: string } | null>(null);
	const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer>();
	const [etag, setEtag] = useState<string>();
	const [loadError, setLoadError] = useState<string>();
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
	const [session, setSession] = useState<CollaborationSession>();
	const [initialUpdate, setInitialUpdate] = useState<Uint8Array>();
	const [collaboration, setCollaboration] = useState<CollaborationState>(
		relayUrl === '' ? { phase: 'disabled' } : { phase: 'preparing' },
	);

	// One identity per mount: the seed this client offers (if it wins the
	// create-if-absent race) and the replica it then opens must be the same
	// client id, or the room would carry two different histories from one
	// browser.
	const clientId = useMemo(() => 1 + Math.floor(Math.random() * 0x7ffffffe), []);
	const authorName = useMemo(
		() => getCurrentUser()?.displayName ?? getCurrentUser()?.uid ?? t('betteroffice', 'Someone'),
		[],
	);

	useEffect(() => {
		onEditorRef?.(editorRef);
	}, [onEditorRef]);

	useEffect(() => {
		let cancelled = false;
		setDocumentBuffer(undefined);
		setInitialUpdate(undefined);
		setSession(undefined);
		initialTokenRef.current = null;
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

	// §8.2 steps 1-7, in order: the document is already loaded (step 1) and
	// its ETag read (step 2); this resolves the room, the seed (generating one
	// only if the room has none) and the token, before the editor opens. The
	// provider connects in step 8, from `handleReplica`.
	useEffect(() => {
		if (!documentBuffer) return;
		if (relayUrl === '') {
			setCollaboration({ phase: 'disabled' });
			return;
		}

		let cancelled = false;
		setCollaboration({ phase: 'preparing' });
		void (async () => {
			try {
				const resolved = await requestCollaborationSession(fileId);
				const seed = await resolveInitialUpdate(fileId, resolved, documentBuffer, clientId);
				if (cancelled) return;
				setSession(resolved);
				initialTokenRef.current = { roomId: resolved.roomId, token: resolved.token };
				setInitialUpdate(seed);
				setCollaboration({ phase: 'live', status: 'connecting', synced: false, peers: 0 });
			} catch (error) {
				if (cancelled) return;
				// Collaboration is not a precondition for editing: a relay that
				// is down or not configured yet must not take the document
				// away. Fall back to the non-collaborative editor and say so.
				console.warn('[betteroffice] collaboration unavailable, editing without it', error);
				setCollaboration({ phase: 'failed' });
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [documentBuffer, fileId, relayUrl, clientId]);

	const clearReconnect = useCallback(() => {
		if (reconnectTimer.current !== null) {
			clearTimeout(reconnectTimer.current);
			reconnectTimer.current = null;
		}
	}, []);

	const scheduleReconnect = useCallback(() => {
		if (reconnectTimer.current !== null) return;
		const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempts.current, RECONNECT_DELAYS_MS.length - 1)];
		reconnectAttempts.current += 1;
		reconnectTimer.current = setTimeout(() => {
			reconnectTimer.current = null;
			const provider = providerRef.current;
			if (provider && provider.status === 'disconnected') provider.connect();
		}, delay);
	}, []);

	useEffect(
		() => () => {
			clearReconnect();
			providerRef.current?.destroy();
			providerRef.current = null;
		},
		[clearReconnect],
	);

	const handleReplica = useCallback(
		(replica: CollaborationReplica | null) => {
			clearReconnect();
			reconnectAttempts.current = 0;
			providerRef.current?.destroy();
			providerRef.current = null;
			if (!replica || !session || relayUrl === '') return;

			// The first attempt reuses the session resolved for the seed; only a
			// reconnect asks for a new one. The token is short-lived
			// (`RoomService::TOKEN_TTL_SECONDS`, five minutes), so reusing the
			// original token on a reconnect would have every attempt after that
			// rejected by the relay -- leaving the editor stuck reconnecting.
			const transport = new WsCollaborationTransport(async () => {
				const initial = initialTokenRef.current;
				if (initial) {
					initialTokenRef.current = null;
					return relaySocketUrl(relayUrl, initial.roomId, initial.token);
				}
				const fresh = await requestCollaborationSession(fileId);
				return relaySocketUrl(relayUrl, fresh.roomId, fresh.token);
			});
			const provider = new CollaborationProvider(replica, transport, { user: { name: authorName } });
			provider.onStatus(({ status, synced }) => {
				setCollaboration((current) => (current.phase === 'live' ? { ...current, status, synced } : current));
				if (status === 'connected') {
					reconnectAttempts.current = 0;
					clearReconnect();
				} else if (status === 'disconnected') {
					// The provider does not retry by itself (its bundled source
					// only reports the status change), so reconnecting is the
					// host's job -- and each attempt gets a fresh token from the
					// transport's resolver.
					scheduleReconnect();
				}
			});
			provider.onPeers((peers) => {
				setCollaboration((current) => (current.phase === 'live' ? { ...current, peers: peers.length } : current));
			});
			provider.connect();
			providerRef.current = provider;
		},
		[clearReconnect, scheduleReconnect, fileId, relayUrl, session, authorName],
	);

	// A fresh object here would re-open the editor on every render, so it is
	// memoised on exactly what the editor reads once.
	const collaborationOptions = useMemo(() => {
		if (!initialUpdate) return undefined;
		return {
			clientId,
			user: { name: authorName },
			initialUpdate,
			onReplica: handleReplica,
		};
	}, [initialUpdate, clientId, authorName, handleReplica]);

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
	if (collaboration.phase === 'preparing') {
		return <div className="betteroffice-editor-message">{t('betteroffice', 'Connecting to collaborators…')}</div>;
	}

	return (
		<div className="betteroffice-editor">
			<SaveStatusBanner status={saveStatus} />
			<CollaborationStatusBar state={collaboration} />
			<DocxEditor
				ref={editorRef}
				documentBuffer={documentBuffer}
				documentName={fileName}
				readOnly={readOnly}
				author={authorName}
				downloadOnSave={false}
				onSaveRequest={() => true}
				onSave={(buffer) => {
					void handleSave(buffer);
				}}
				onError={() => {
					setSaveStatus((current) => (current === 'saving' ? 'error' : current));
				}}
				collaboration={collaborationOptions}
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

/**
 * Minimal presence indicator (PLAN.md §8.6): connection state and how many
 * other people are in the room. Full presence (avatars, per-user read/write
 * status) is Phase 4+ work; this is deliberately just enough for a user to
 * tell whether their edits are reaching anyone.
 */
function CollaborationStatusBar({ state }: { state: CollaborationState }) {
	if (state.phase === 'disabled') return null;
	if (state.phase === 'preparing') {
		return (
			<div className="betteroffice-collaboration-status" data-collaboration-status="preparing">
				{t('betteroffice', 'Connecting to collaborators…')}
			</div>
		);
	}
	if (state.phase === 'failed') {
		return (
			<div
				className="betteroffice-collaboration-status betteroffice-collaboration-status--offline"
				data-collaboration-status="unavailable"
				data-collaboration-synced="0"
				data-collaboration-peers="0"
			>
				{t('betteroffice', 'Live collaboration is unavailable right now — you are editing on your own. Saving still works.')}
			</div>
		);
	}

	const live = state.status === 'connected' && state.synced;
	return (
		<div
			className={`betteroffice-collaboration-status${live ? '' : ' betteroffice-collaboration-status--offline'}`}
			data-collaboration-status={live ? 'connected' : state.status}
			data-collaboration-synced={live ? '1' : '0'}
			data-collaboration-peers={state.peers}
		>
			{live
				? t('betteroffice', 'Live collaboration — {count} other editor(s) here', { count: state.peers })
				: t('betteroffice', 'Reconnecting to collaborators…')}
		</div>
	);
}
