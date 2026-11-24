<?php
/** @var \OCP\IL10N $l */
// @nextcloud/vite-config names the built chunk "betteroffice-main.mjs" --
// JSResourceLocator looks for the exact filename passed, app-id prefix included.
\OCP\Util::addScript('betteroffice', 'betteroffice-main');
\OCP\Util::addStyle('betteroffice', 'style');
?>
<div id="betteroffice-app"></div>
