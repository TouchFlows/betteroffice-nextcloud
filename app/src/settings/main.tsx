import { createRoot } from 'react-dom/client';
import { SettingsApp } from './SettingsApp';

const mount = document.getElementById('betteroffice-settings');
if (mount) {
	createRoot(mount).render(
		<SettingsApp relayUrl={mount.dataset.relayUrl ?? ''} secret={mount.dataset.secret ?? ''} />,
	);
}
