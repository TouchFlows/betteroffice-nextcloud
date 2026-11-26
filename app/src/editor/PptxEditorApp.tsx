import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { getCurrentUser } from '@nextcloud/auth';
import { translate as t } from '@nextcloud/l10n';
import { PptxEditor, type PptxAsyncEditorApi } from '@betteroffice/pptx-react';
import { initWasm } from '@betteroffice/pptx';
import { CollaborationProvider, type AsyncCollaborationReplica } from '@betteroffice/pptx/collaboration';
import { loadDocument, saveDocument, type LoadedDocument } from './documentApi';
import { SaveStatusLine, type SaveStatus } from './saveStatus';
import type { FormatEditorProps } from './XlsxEditorApp';
import { CollaborationStatusBar, type CollaborationState } from './collaboration/CollaborationStatus';
import { generatePptxSeed } from './collaboration/pptxSeed';
import {
	relaySocketUrl,
	requestCollaborationSession,
	resolveInitialUpdate,
	type CollaborationSession,
} from './collaboration/session';
import { WsCollaborationTransport } from './collaboration/transport';
import { usePresenceRoster } from './collaboration/usePresenceRoster';

/**
 * Presentation editor (Phase 4). Saves the same way the spreadsheet editor
 * does -- bytes from DocumentController, serialised by the editor, written
 * back with the ETag they were loaded with -- and, when a relay is
 * configured, joins the file's collaboration room.
 *
 * PPTX collaboration differs from DOCX's in three places, all of them settled
 * by its own typings (poc/RECONNAISSANCE.md §3): the editor hands its replica
 * to `collaboration.onReplica` typed as an `AsyncCollaborationReplica`; the
 * provider takes that directly, with no `createAsyncCollaborationReplica`
 * adapter to wrap it in; and the roster is triggered by `onPresence` rather
 * than `onPeers`. The transport and the status/presence chrome are shared.
 *
 * `onPresence` reports the awareness state, which each browser writes about
 * itself, so it is used only as the signal that the room changed: the names,
 * roles and avatars shown come from the relay's `/presence` endpoint, which
 * answers with the identity signed into the token (§8.6) -- the same source
 * the DOCX editor reads.
 *
 * `fonts` is mandatory on `PptxEditor` even without collaboration, and an
 * empty list is the documented default rather than an omission.
 */
export interface PptxEditorAppProps extends FormatEditorProps {
	/** Relay base URL from the server (`data-relay-url`); empty means collaboration is not configured. */
	relayUrl?: string;
	/**
	 * Hands the live editor API to an embedding host. The e2e harness uses it
	 * to read the deck's text, which is painted to canvas and therefore has no
	 * DOM to query; production code has no need for it.
	 */
	onReady?: (api: PptxAsyncEditorApi) => void;
}

/**
 * Backoff after the relay drops the socket, capped rather than giving up: a
 * relay restart or a laptop waking up should heal without a page reload.
 */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000];
/**
 * `onPresence` fires for cursor movement as well as joins and leaves, so
 * roster reads are debounced to at most one a second.
 */
const PRESENCE_ROSTER_DEBOUNCE_MS = 1_000;

export function PptxEditorApp({ fileId, fileName, readOnly, relayUrl = '', onReady }: PptxEditorAppProps) {
	const [document, setDocument] = useState<LoadedDocument>();
	const [loadError, setLoadError] = useState<string>();
	const [status, setStatus] = useState<SaveStatus>('idle');
	const [session, setSession] = useState<CollaborationSession>();
	const [initialUpdate, setInitialUpdate] = useState<Uint8Array>();
	const [collaboration, setCollaboration] = useState<CollaborationState>(
		relayUrl === '' ? { phase: 'disabled' } : { phase: 'preparing' },
	);
	const etag = useRef('');
	const providerRef = useRef<CollaborationProvider | null>(null);
	const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectAttempts = useRef(0);
	/**
	 * The session the seed handshake resolved, for the provider's first
	 * connection only: opening a document already resolved one, and asking for
	 * a second token moments later is a redundant round trip. A reconnect may
	 * come long after the token's five-minute life, so it asks again.
	 */
	const initialTokenRef = useRef<{ roomId: string; token: string } | null>(null);

	// One identity per mount: the client id that offered the seed must be the
	// one the replica opens with, or one browser would carry two histories.
	const clientId = useMemo(() => 1 + Math.floor(Math.random() * 0x7ffffffe), []);
	const authorName = useMemo(
		() => getCurrentUser()?.displayName ?? getCurrentUser()?.uid ?? t('betteroffice', 'Someone'),
		[],
	);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				await initWasm();
				const loaded = await loadDocument(fileId);
				if (cancelled) {
					return;
				}
				etag.current = loaded.etag;
				setDocument(loaded);
			} catch {
				if (!cancelled) {
					setLoadError(t('betteroffice', 'Could not open this file.'));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [fileId]);

	// PLAN.md §8.2 steps 1-7: the file is loaded, the room resolved, the seed
	// adopted (offering one only when the room has none), and the editor opens
	// with it. The provider connects from `handleReplica`.
	useEffect(() => {
		if (!document) return;
		if (relayUrl === '') {
			setCollaboration({ phase: 'disabled' });
			return;
		}

		let cancelled = false;
		setCollaboration({ phase: 'preparing' });
		void (async () => {
			try {
				const resolved = await requestCollaborationSession(fileId);
				const seed = await resolveInitialUpdate(fileId, resolved, () => generatePptxSeed(document.bytes, clientId));
				if (cancelled) return;
				setSession(resolved);
				initialTokenRef.current = { roomId: resolved.roomId, token: resolved.token };
				setInitialUpdate(seed);
				setCollaboration({ phase: 'live', status: 'connecting', synced: false, peers: 0 });
			} catch (error) {
				if (cancelled) return;
				// Collaboration is not a precondition for editing: a relay that
				// is down or not configured must not take the deck away.
				console.warn('[betteroffice] collaboration unavailable, editing without it', error);
				setCollaboration({ phase: 'failed' });
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [document, fileId, relayUrl, clientId]);

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

	// §8.6 presence: awareness tells us *when* the room changed (see
	// `onPresence` below) and how many are in it; the identities shown come
	// from the relay's `/presence` endpoint, where they are the ones signed
	// into each token. The plumbing lives in one hook so the spreadsheet editor
	// does not become a third copy.
	const { participants, refresh: refreshRoster } = usePresenceRoster({
		fileId,
		relayUrl,
		session,
		active: collaboration.phase === 'live',
	});

	const handleReplica = useCallback(
		(replica: AsyncCollaborationReplica | null) => {
			clearReconnect();
			reconnectAttempts.current = 0;
			providerRef.current?.destroy();
			providerRef.current = null;
			if (!replica || !session || relayUrl === '') return;

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
			provider.onStatus(({ status: connection, synced }) => {
				setCollaboration((current) => (current.phase === 'live' ? { ...current, status: connection, synced } : current));
				if (connection === 'connected') {
					reconnectAttempts.current = 0;
					clearReconnect();
					// The room's participants are known now; read the roster at once.
					refreshRoster(0);
				} else if (connection === 'disconnected') {
					// The provider reports a drop but does not retry by itself.
					scheduleReconnect();
				}
			});
			// Presence (§8.6): awareness tells us *when* the room changed and how
			// many are in it; the identities come from the relay's `/presence`
			// endpoint, where they are the ones signed into each token.
			provider.onPresence((peers) => {
				setCollaboration((current) => (current.phase === 'live' ? { ...current, peers: peers.length } : current));
				refreshRoster(PRESENCE_ROSTER_DEBOUNCE_MS);
			});
			provider.connect();
			providerRef.current = provider;
		},
		[clearReconnect, scheduleReconnect, refreshRoster, fileId, relayUrl, session, authorName],
	);

	// A fresh object here would re-open the editor on every render, so it is
	// memoised on exactly what the editor reads once.
	const collaborationOptions = useMemo(() => {
		if (!initialUpdate) return undefined;
		return { clientId, initialUpdate, onReplica: handleReplica };
	}, [initialUpdate, clientId, handleReplica]);

	const handleSave = useCallback(
		(bytes: Uint8Array) => {
			void (async () => {
				setStatus('saving');
				try {
					etag.current = await saveDocument(fileId, bytes, etag.current);
					setStatus('saved');
				} catch (error) {
					// 409 is the stale-ETag refusal, not a broken save (§9.3).
					setStatus(isAxiosError(error) && error.response?.status === 409 ? 'conflict' : 'error');
				}
			})();
		},
		[fileId],
	);

	if (loadError !== undefined) {
		return (
			<p className="betteroffice-save-status" role="alert">
				{loadError}
			</p>
		);
	}
	if (document === undefined) {
		return (
			<p className="betteroffice-save-status" role="status">
				{t('betteroffice', 'Opening…')}
			</p>
		);
	}
	// Mounting before the seed arrives would open the deck without a
	// collaboration room and then replace it, losing whatever the user did
	// while the handshake ran.
	if (collaboration.phase === 'preparing') {
		return (
			<div className="betteroffice-editor-message">{t('betteroffice', 'Connecting to collaborators…')}</div>
		);
	}

	return (
		<div className="betteroffice-format-editor">
			<h1 className="hidden-visually">{fileName}</h1>
			<SaveStatusLine status={status} />
			<CollaborationStatusBar state={collaboration} participants={participants} />
			<div className="betteroffice-format-editor__canvas">
				<PptxEditor
					file={document.bytes}
					fonts={[]}
					readOnly={readOnly}
					onSave={handleSave}
					onReady={onReady}
					collaboration={collaborationOptions}
				/>
			</div>
		</div>
	);
}
