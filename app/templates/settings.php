<?php
/**
 * @var array $_ The parameters set by Settings\Admin::getForm().
 * @var \OCP\IL10N $l
 */
// @nextcloud/vite-config names the built chunk "betteroffice-settings.mjs" --
// JSResourceLocator looks for the exact filename passed, app-id prefix included.
\OCP\Util::addScript('betteroffice', 'betteroffice-settings');
\OCP\Util::addStyle('betteroffice', 'style');
?>
<div
	id="betteroffice-settings"
	data-relay-url="<?php p($_['relayUrl']); ?>"
	data-secret="<?php p($_['secret']); ?>"
></div>
