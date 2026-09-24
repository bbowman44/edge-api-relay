/**
 * edge-api-relay
 *
 * A small personal API. A cron trigger pulls from upstream sources on a
 * schedule and writes the results to KV; the fetch handler only ever reads
 * KV. Clients therefore never wait on an upstream call, and an upstream
 * outage serves the last good value instead of an error.
 */

import { fetchWowToken } from './sources/wowToken';

export interface RelayEnv {
	CACHE: KVNamespace;
	BLIZZARD_CLIENT_ID: string;
	BLIZZARD_CLIENT_SECRET: string;
	/** Shared secret the client sends as X-API-Key. Optional. */
	API_KEY?: string;
}

/** What the cron writes and the fetch handler serves. */
interface Slot {
	value: string;
	updated: number;
	[extra: string]: unknown;
}

type Slots = Record<string, Slot>;

const SLOTS_KEY = 'slots';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	});
}

/**
 * Refreshes every source and merges the results into the stored slots.
 * A source that throws leaves its previous value in place rather than
 * blanking the slot.
 */
async function refresh(env: RelayEnv): Promise<Slots> {
	const existing = ((await env.CACHE.get(SLOTS_KEY, 'json')) ?? {}) as Slots;
	const next: Slots = { ...existing };

	try {
		const token = await fetchWowToken(env);
		next.wow = {
			value: token.value,
			gold: token.gold,
			updated: token.updated,
		};
	} catch (err) {
		console.error('wowToken refresh failed:', err);
	}

	await env.CACHE.put(SLOTS_KEY, JSON.stringify(next));
	return next;
}

export default {
	async scheduled(_event: ScheduledController, env: RelayEnv, ctx: ExecutionContext) {
		ctx.waitUntil(refresh(env));
	},

	async fetch(request: Request, env: RelayEnv): Promise<Response> {
		const url = new URL(request.url);

		// Optional shared-secret gate. Deters casual scanning; it is not
		// meaningful security, since the key ships inside the client.
		if (env.API_KEY && request.headers.get('X-API-Key') !== env.API_KEY) {
			return json({ error: 'unauthorized' }, 401);
		}

		if (url.pathname === '/health') {
			return json({ ok: true });
		}

		// Manual refresh, for testing without waiting for the cron.
		if (url.pathname === '/refresh') {
			const slots = await refresh(env);
			return json({ slots });
		}

		const slots = ((await env.CACHE.get(SLOTS_KEY, 'json')) ?? {}) as Slots;

		// /slots/wow returns just that slot, for a client that wants one value. This also can match any object that exists in the slots variable such as a weather object (/slots/weather) and returns it json formatted.
		const match = url.pathname.match(/^\/slots\/([a-z0-9_-]+)$/i);
		if (match) {
			const slot = slots[match[1]];
			return slot ? json(slot) : json({ error: 'no such slot' }, 404);
		}

		return json({ slots });
	},
} satisfies ExportedHandler<RelayEnv>;
