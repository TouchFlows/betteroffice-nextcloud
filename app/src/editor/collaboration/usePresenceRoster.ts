import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPresence, PresenceAuthError, type PresenceParticipant } from './presence';
import { requestCollaborationSession, type CollaborationSession } from './session';

/**
 * The presence roster (PLAN.md §8.6) as one piece of plumbing, shared by the
 * editors that have one. It was written twice -- once in the DOCX app polling
 * on a timer, once in the presentation app debouncing `onPresence` -- and the
 * spreadsheet editor would have been the third copy.
 *
 * What the formats genuinely differ in is *when* to re-read: DOCX polls, PPTX
 * is told by its provider. So this hook owns the parts that are the same --
 * which token a read uses, what to do when the relay refuses it, coalescing
 * bursts of triggers, and ignoring a roster that did not change -- and leaves
 * the trigger to the caller (`refresh()` plus an optional `pollMs`).
 *
 * Identity here is always the one the server signed into the participant's
 * token, never the awareness payload each browser writes about itself.
 */

/**
 * A collaboration token stays valid for five minutes
 * (`RoomService::TOKEN_TTL_SECONDS`). Roster reads reuse the token the session
 * handshake already resolved until it nears expiry, so an open editor does not
 * ask for a new session on every refresh.
 */
const TOKEN_REUSE_MS = 4 * 60_000;

export interface PresenceRosterOptions {
	fileId: number;
	/** Empty means collaboration is not configured; the roster stays empty. */
	relayUrl: string;
	/** The session the seed handshake resolved; null until it has. */
	session: CollaborationSession | undefined;
	/** Whether the room is live. While false the roster is cleared and reads stop. */
	active: boolean;
	/** Re-read on this interval while active; omitted means only on `refresh()`. */
	pollMs?: number;
}

export interface PresenceRoster {
	participants: PresenceParticipant[];
	/**
	 * Schedules a read, coalesced: a trigger that arrives while one is already
	 * scheduled is dropped, which is what keeps cursor-driven presence events
	 * from costing a request each.
	 */
	refresh: (delayMs?: number) => void;
}

function sameParticipants(a: PresenceParticipant[], b: PresenceParticipant[]): boolean {
	return a.length === b.length
		&& a.every((participant, index) =>
			participant.name === b[index].name
			&& participant.avatar === b[index].avatar
			&& participant.role === b[index].role
			&& participant.self === b[index].self);
}

export function usePresenceRoster({ fileId, relayUrl, session, active, pollMs }: PresenceRosterOptions): PresenceRoster {
	const [participants, setParticipants] = useState<PresenceParticipant[]>([]);
	const tokenRef = useRef<{ roomId: string; token: string; at: number } | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const readingRef = useRef(false);

	// Adopt the token the handshake resolved: it is already signed for this
	// room, so the first roster read costs no round trip.
	useEffect(() => {
		tokenRef.current = session && relayUrl !== ''
			? { roomId: session.roomId, token: session.token, at: Date.now() }
			: null;
	}, [session, relayUrl]);

	const read = useCallback(async () => {
		if (relayUrl === '' || readingRef.current) return;
		readingRef.current = true;
		try {
			const load = async (): Promise<PresenceParticipant[]> => {
				let token = tokenRef.current;
				if (token === null || Date.now() - token.at >= TOKEN_REUSE_MS) {
					const fresh = await requestCollaborationSession(fileId);
					token = { roomId: fresh.roomId, token: fresh.token, at: Date.now() };
					tokenRef.current = token;
				}
				return fetchPresence(relayUrl, token.roomId, token.token);
			};

			let roster: PresenceParticipant[];
			try {
				roster = await load();
			} catch (error) {
				if (!(error instanceof PresenceAuthError)) throw error;
				// 401/403: this token is dead for good -- expired, or signed for a
				// room the relay no longer serves. Retrying it until the reuse
				// window runs out would leave the roster empty for minutes, so
				// forget it and resolve a new session straight away.
				tokenRef.current = null;
				roster = await load();
			}
			// Only a changed roster is worth a re-render: the editors below are
			// heavy components and a poll must not re-render them for nothing.
			setParticipants((current) => (sameParticipants(current, roster) ? current : roster));
		} catch {
			// Presence is informational: a relay that cannot answer it must not
			// affect editing, and a stale roster is worse than none.
			setParticipants([]);
		} finally {
			readingRef.current = false;
		}
	}, [fileId, relayUrl]);

	const refresh = useCallback(
		(delayMs = 0) => {
			if (timerRef.current !== null) return;
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				void read();
			}, delayMs);
		},
		[read],
	);

	useEffect(() => {
		if (!active || relayUrl === '') {
			setParticipants([]);
			return;
		}
		refresh(0);
		if (pollMs === undefined) return;
		const timer = setInterval(() => refresh(0), pollMs);
		return () => clearInterval(timer);
	}, [active, relayUrl, pollMs, refresh]);

	useEffect(
		() => () => {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		},
		[],
	);

	return { participants, refresh };
}
