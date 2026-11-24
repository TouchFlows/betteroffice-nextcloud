<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Listener;

use OCP\Collaboration\Resources\LoadAdditionalScriptsEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * Injects the "Open with BetterOffice" file action into the Files app
 * (PLAN.md §6.2) without monkey-patching Files or its click handlers.
 *
 * `OCP\Collaboration\Resources\LoadAdditionalScriptsEvent` (since 25.0.0) is
 * the one actually dispatched when the Files app renders -- confirmed
 * against a live Nextcloud 34 instance by reading how richdocuments (whose
 * own file action does load there) registers its listener.
 * `OCA\Files\Event\LoadAdditionalScriptsEvent` also exists but is not what
 * fires here; using it is why this script silently never loaded at first.
 *
 * @template-implements IEventListener<LoadAdditionalScriptsEvent>
 */
class LoadAdditionalScriptsListener implements IEventListener {
	public function handle(Event $event): void {
		if (!$event instanceof LoadAdditionalScriptsEvent) {
			return;
		}

		// @nextcloud/vite-config names the built chunk "betteroffice-files.mjs" --
		// JSResourceLocator looks for the exact filename passed, app-id prefix included.
		Util::addScript('betteroffice', 'betteroffice-files');
	}
}
