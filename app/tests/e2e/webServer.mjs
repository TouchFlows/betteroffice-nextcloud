#!/usr/bin/env node
/**
 * Runs a harness web server and stops it when the run that started it goes
 * away.
 *
 * Playwright runs a `webServer.command` through a shell, and on a clean exit it
 * kills what it spawned. A killed run -- SIGKILL, a cancelled job, a tool
 * timeout -- runs none of that cleanup: the servers are reparented and keep
 * their ports, and the next run refuses to start ("http://127.0.0.1:8788/health
 * is already used"). A reparented process gets no signal, but its parent id
 * changes, and that is the one thing it can observe.
 *
 * Playwright starts this through `exec` (see playwright.config.ts), so it
 * replaces the shell and is Playwright's direct child. The server it spawns
 * stays in the same process group, so Playwright's own shutdown still reaches
 * it, and stdio is inherited so the server's log stays in the run's output.
 */
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) {
	console.error('usage: webServer.mjs <command> [args...]');
	process.exit(2);
}

const parent = process.ppid;
const child = spawn(command, args, { stdio: 'inherit' });

let stopping = false;
function stop(signal) {
	if (stopping) return;
	stopping = true;
	child.kill(signal);
	// A server that ignores SIGTERM must not outlive the wrapper either.
	setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on('error', (error) => {
	console.error(`[harness] could not start ${command}:`, error);
	process.exit(1);
});

const timer = setInterval(() => {
	if (process.ppid === parent) return;
	console.warn('[harness] the run that started this server is gone, stopping it');
	clearInterval(timer);
	stop('SIGTERM');
}, 1_000);
timer.unref();
