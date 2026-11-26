import { translate as t } from '@nextcloud/l10n';
import type { PresenceParticipant } from './presence';

/**
 * The collaboration chrome every format shows. Extracted from the DOCX editor
 * app so the spreadsheet and presentation editors can share it rather than
 * grow a second copy: each format wires its own provider
 * (poc/RECONNAISSANCE.md §3), but what the user sees while connected is the
 * same in all three.
 *
 * The status union is declared here rather than imported from one of the
 * BetterOffice packages: all three providers report these four values, and
 * importing any single package's type would make the shared UI that package's
 * shape again.
 */

export type CollaborationConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'destroyed';

export type CollaborationState =
	| { phase: 'disabled' }
	| { phase: 'preparing' }
	| { phase: 'live'; status: CollaborationConnectionStatus; synced: boolean; peers: number }
	| { phase: 'failed' };

/**
 * Presence (PLAN.md §8.6): connection state, how many other people are in the
 * room, and who they are -- display name, avatar and read-only/editing role,
 * all as reported by the server (`presence.ts`).
 */
export function CollaborationStatusBar({
	state,
	participants,
}: {
	state: CollaborationState;
	participants: PresenceParticipant[];
}) {
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
			{live && <PresenceList participants={participants} />}
		</div>
	);
}

/** The other people in the room, skipping the caller's own entry. */
export function PresenceList({ participants }: { participants: PresenceParticipant[] }) {
	const others = participants.filter((participant) => !participant.self);
	if (others.length === 0) return null;

	return (
		<ul className="betteroffice-collaboration-presence" data-collaboration-presence={others.length}>
			{others.map((participant) => (
				<li
					key={`${participant.name}-${participant.role}`}
					className="betteroffice-collaboration-presence__participant"
					data-collaboration-role={participant.role}
				>
					{participant.avatar !== null && (
						<img
							className="betteroffice-collaboration-presence__avatar"
							src={participant.avatar}
							alt=""
							width={16}
							height={16}
						/>
					)}
					<span className="betteroffice-collaboration-presence__name">{participant.name}</span>
					{participant.role === 'read' && (
						<span className="betteroffice-collaboration-presence__role">
							{t('betteroffice', 'read-only')}
						</span>
					)}
				</li>
			))}
		</ul>
	);
}
