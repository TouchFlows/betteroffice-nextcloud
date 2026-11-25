<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Settings;

use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

/**
 * The app's own entry in Settings → Administration, registered in
 * `appinfo/info.xml` (PLAN.md §11: the app should look and behave like a
 * first-party Nextcloud application, which includes living in its own
 * section rather than in "Additional settings").
 */
class Section implements IIconSection {
	public const ID = 'betteroffice';

	public function __construct(
		private IL10N $l,
		private IURLGenerator $urlGenerator,
	) {
	}

	public function getID(): string {
		return self::ID;
	}

	public function getName(): string {
		return $this->l->t('BetterOffice');
	}

	public function getPriority(): int {
		// Below Nextcloud's own server/security sections (which sit in the
		// 0-20 range) and above nothing in particular: this is a
		// document-editing app, not an instance-wide concern.
		return 75;
	}

	public function getIcon(): string {
		return $this->urlGenerator->imagePath('betteroffice', 'app.svg');
	}
}
