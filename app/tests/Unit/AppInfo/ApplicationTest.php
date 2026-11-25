<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Tests\Unit\AppInfo;

use OCA\BetterOffice\AppInfo\Application;
use OCA\BetterOffice\Settings\Admin;
use OCA\BetterOffice\Settings\Section;
use OCP\Settings\IIconSection;
use OCP\Settings\ISettings;
use PHPUnit\Framework\TestCase;

/**
 * Deliberately does not instantiate Application: its constructor boots a
 * real Nextcloud DI container, which this suite has no running server to
 * provide. These checks catch the class existing, its declared app ID, and
 * routes.php/info.xml staying consistent, without needing one.
 */
class ApplicationTest extends TestCase {
	public function testAppIdMatchesInfoXml(): void {
		$info = simplexml_load_file(__DIR__ . '/../../../appinfo/info.xml');
		self::assertNotFalse($info, 'appinfo/info.xml must parse');
		self::assertSame(Application::APP_ID, (string)$info->id);
	}

	public function testNavigationRouteExists(): void {
		$routes = require __DIR__ . '/../../../appinfo/routes.php';
		$names = array_map(static fn (array $route) => $route['name'], $routes['routes']);
		self::assertContains('page#index', $names, 'routes.php must define the navigation route page#index');
	}

	/**
	 * info.xml is the only thing that registers the admin settings page; a
	 * mistyped class name there silently produces no page at all, which no
	 * amount of controller testing would catch.
	 */
	public function testAdminSettingsAreRegisteredInInfoXml(): void {
		$info = simplexml_load_file(__DIR__ . '/../../../appinfo/info.xml');
		self::assertNotFalse($info, 'appinfo/info.xml must parse');

		$admin = (string)$info->settings->admin;
		$section = (string)$info->settings->{'admin-section'};

		self::assertTrue(is_subclass_of($admin, ISettings::class), "{$admin} must implement ISettings");
		self::assertTrue(is_subclass_of($section, IIconSection::class), "{$section} must implement IIconSection");
		self::assertSame(Admin::class, $admin);
		self::assertSame(Section::class, $section);
	}

	public function testSettingsRoutesExist(): void {
		$routes = require __DIR__ . '/../../../appinfo/routes.php';
		$names = array_map(static fn (array $route) => $route['name'], $routes['routes']);

		self::assertContains('settings#saveRelayUrl', $names);
		self::assertContains('settings#regenerateSecret', $names);
	}
}
