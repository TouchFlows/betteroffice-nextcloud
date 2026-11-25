import { useState, type FormEvent } from 'react';
import axios, { isAxiosError } from '@nextcloud/axios';
import { generateUrl } from '@nextcloud/router';
import { translate as t } from '@nextcloud/l10n';

/**
 * Admin settings (PLAN.md §4.A, §11): the relay URL and the secret shared
 * with the relay. Validation, persistence and token issuance all live on the
 * server (`SettingsController`, `RelayConfigService`); this is only the form.
 */
export interface SettingsAppProps {
	/** Currently stored relay base URL; empty means collaboration is disabled. */
	relayUrl: string;
	/** The collaboration secret, generated on first visit if it did not exist yet. */
	secret: string;
}

type Status = { kind: 'idle' } | { kind: 'saved' | 'error'; message: string };

const relayUrlEndpoint = generateUrl('/apps/betteroffice/settings/relay-url');
const regenerateSecretEndpoint = generateUrl('/apps/betteroffice/settings/secret');

function failureMessage(error: unknown, fallback: string): string {
	if (isAxiosError(error)) {
		const message = (error.response?.data as { message?: unknown } | undefined)?.message;
		if (typeof message === 'string' && message !== '') {
			return message;
		}
	}
	return fallback;
}

export function SettingsApp({ relayUrl: initialRelayUrl, secret: initialSecret }: SettingsAppProps) {
	const [relayUrl, setRelayUrl] = useState(initialRelayUrl);
	const [savedRelayUrl, setSavedRelayUrl] = useState(initialRelayUrl);
	const [secret, setSecret] = useState(initialSecret);
	const [status, setStatus] = useState<Status>({ kind: 'idle' });
	const [busy, setBusy] = useState(false);

	const saveRelayUrl = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		try {
			const { data } = await axios.post<{ relayUrl: string }>(relayUrlEndpoint, { relayUrl });
			setRelayUrl(data.relayUrl);
			setSavedRelayUrl(data.relayUrl);
			setStatus({
				kind: 'saved',
				message: data.relayUrl === ''
					? t('betteroffice', 'Collaboration is now disabled.')
					: t('betteroffice', 'Relay URL saved.'),
			});
		} catch (error) {
			setStatus({
				kind: 'error',
				message: failureMessage(error, t('betteroffice', 'Could not save the relay URL.')),
			});
		} finally {
			setBusy(false);
		}
	};

	const regenerateSecret = async () => {
		const confirmed = window.confirm(t('betteroffice', 'Regenerate the collaboration secret? Every editor currently connected loses collaboration until the relay is updated with the new secret and restarted.'));
		if (!confirmed) {
			return;
		}

		setBusy(true);
		try {
			const { data } = await axios.post<{ secret: string }>(regenerateSecretEndpoint);
			setSecret(data.secret);
			setStatus({
				kind: 'saved',
				message: t('betteroffice', 'Secret regenerated. Copy it into the relay configuration and restart the relay.'),
			});
		} catch (error) {
			setStatus({
				kind: 'error',
				message: failureMessage(error, t('betteroffice', 'Could not regenerate the secret.')),
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="betteroffice-settings">
			<form className="betteroffice-settings-block" onSubmit={saveRelayUrl}>
				<label htmlFor="betteroffice-relay-url">{t('betteroffice', 'Collaboration relay URL')}</label>
				<input
					id="betteroffice-relay-url"
					type="url"
					value={relayUrl}
					placeholder="wss://relay.example.com"
					disabled={busy}
					onChange={(event) => setRelayUrl(event.target.value)}
				/>
				<p className="betteroffice-settings-hint">
					{t('betteroffice', 'Base URL of the self-hosted collaboration relay (wss://, ws://, https:// or http://). Leave empty to disable live collaboration — documents can still be opened and saved.')}
				</p>
				<button type="submit" disabled={busy || relayUrl === savedRelayUrl}>
					{t('betteroffice', 'Save')}
				</button>
			</form>

			<div className="betteroffice-settings-block">
				<label htmlFor="betteroffice-collaboration-secret">{t('betteroffice', 'Collaboration secret')}</label>
				<input
					id="betteroffice-collaboration-secret"
					className="betteroffice-settings-secret"
					type="text"
					value={secret}
					readOnly
					onFocus={(event) => event.currentTarget.select()}
				/>
				<p className="betteroffice-settings-hint">
					{t('betteroffice', 'The relay verifies collaboration tokens with this secret. Set it as BETTEROFFICE_RELAY_SHARED_SECRET in the relay configuration. Regenerating it disconnects every open editor until the relay is restarted with the new value.')}
				</p>
				<button type="button" disabled={busy} onClick={regenerateSecret}>
					{t('betteroffice', 'Regenerate secret')}
				</button>
			</div>

			{status.kind !== 'idle' && (
				<p
					className={status.kind === 'error'
						? 'betteroffice-settings-status betteroffice-settings-status--error'
						: 'betteroffice-settings-status'}
					role="status"
				>
					{status.message}
				</p>
			)}
		</div>
	);
}
