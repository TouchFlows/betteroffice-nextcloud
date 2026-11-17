/**
 * Centralises env parsing so the server, the migration runner and tests all
 * read the same variables the same way. Durable-persistence settings
 * (§5.2/§8.4) are only required by the migration runner today — the server
 * itself has nothing to persist yet (that lands in Phase 3).
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
