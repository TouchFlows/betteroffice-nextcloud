<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\Settings;

use OCA\BetterOffice\Settings\Section;
use OCP\IL10N;
use OCP\IURLGenerator;
use PHPUnit\Framework\TestCase;

class SectionTest extends TestCase {
	public function testIdIsTheAppId(): void {
		$section = new Section(
			$this->createStub(IL10N::class),
			$this->createStub(IURLGenerator::class),
		);

		// The settings form's getSection() names this same id, which is what
		// puts the form in this section rather than in "Additional settings".
		self::assertSame('betteroffice', $section->getID());
	}

	public function testNameIsTranslated(): void {
		$l10n = $this->createMock(IL10N::class);
		$l10n->expects(self::once())->method('t')->with('BetterOffice')->willReturn('BetterOffice');

		$section = new Section($l10n, $this->createStub(IURLGenerator::class));

		self::assertSame('BetterOffice', $section->getName());
	}

	public function testIconIsTheAppIcon(): void {
		$urlGenerator = $this->createMock(IURLGenerator::class);
		$urlGenerator->expects(self::once())
			->method('imagePath')
			->with('betteroffice', 'app.svg')
			->willReturn('/apps/betteroffice/img/app.svg');

		$section = new Section($this->createStub(IL10N::class), $urlGenerator);

		self::assertSame('/apps/betteroffice/img/app.svg', $section->getIcon());
	}

	public function testPriorityIsWithinTheRangeNextcloudRequires(): void {
		$section = new Section(
			$this->createStub(IL10N::class),
			$this->createStub(IURLGenerator::class),
		);

		self::assertGreaterThanOrEqual(0, $section->getPriority());
		self::assertLessThanOrEqual(99, $section->getPriority());
	}
}
