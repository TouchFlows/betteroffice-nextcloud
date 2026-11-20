<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * Injects the "Open with BetterOffice" file action into the Files app
 * (PLAN.md §6.2) without monkey-patching Files or its click handlers --
 * this is the Files app's own documented extension point for additional
 * scripts.
 *
 * @template-implements IEventListener<LoadAdditionalScriptsEvent>
 */
class LoadAdditionalScriptsListener implements IEventListener {
	public function handle(Event $event): void {
		if (!$event instanceof LoadAdditionalScriptsEvent) {
			return;
		}

		Util::addScript('betteroffice', 'files');
	}
}
