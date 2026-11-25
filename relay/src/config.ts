/**
 * Centralises env parsing so the server, the migration runner and tests all
 * read the same variables the same way.
 */
export interface RelayConfig {
	port: number;
	database: {
		host: string;
		port: number;
		database: string;
		user: string;
		password: string;
	};
}

/** Only the WebSocket server needs these -- `migrate.ts` must not require them just to run a migration. */
export interface RelayServerConfig extends RelayConfig {
	/** Shared with the Nextcloud app (`RoomService`) to verify collaboration tokens (§8.5). */
	sharedSecret: string;
	/** Exact origin the Nextcloud app is served from -- the relay rejects any other (§13 "Strict Origin validation"). */
	allowedOrigin: string;
}

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

export function loadConfig(): RelayConfig {
	return {
		port: Number(process.env.BETTEROFFICE_RELAY_PORT ?? 8787),
		database: {
			host: process.env.BETTEROFFICE_RELAY_DB_HOST ?? '127.0.0.1',
			port: Number(process.env.BETTEROFFICE_RELAY_DB_PORT ?? 3306),
			database: required('BETTEROFFICE_RELAY_DB_NAME'),
			user: required('BETTEROFFICE_RELAY_DB_USER'),
			password: required('BETTEROFFICE_RELAY_DB_PASSWORD'),
		},
	};
}

export function loadServerConfig(): RelayServerConfig {
	return {
		...loadConfig(),
		sharedSecret: required('BETTEROFFICE_RELAY_SHARED_SECRET'),
		allowedOrigin: required('BETTEROFFICE_RELAY_ALLOWED_ORIGIN'),
	};
}
