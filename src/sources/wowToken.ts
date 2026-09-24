/**
 * WoW Token price, via the Blizzard Game Data API.
 *
 * Uses the OAuth2 client-credentials flow: no user consent, no redirect.
 * The access token is valid for ~24h, so it is cached in KV and only
 * re-requested when missing or expired.
 */

const OAUTH_URL = 'https://oauth.battle.net/token';
const TOKEN_INDEX_URL = 'https://us.api.blizzard.com/data/wow/token/index';
const NAMESPACE = 'dynamic-us';
const ACCESS_TOKEN_KEY = 'blizzard:access_token';

const COPPER_PER_GOLD = 10_000;

interface OAuthResponse {
	access_token: string;
	expires_in: number;
}

interface TokenIndexResponse {
	price: number;
	last_updated_timestamp: number;
}

export interface WowTokenResult {
	value: string;
	gold: number;
	updated: number;
}

async function getAccessToken(env: {
	CACHE: KVNamespace;
	BLIZZARD_CLIENT_ID: string;
	BLIZZARD_CLIENT_SECRET: string;
}): Promise<string> {
	const cached = await env.CACHE.get(ACCESS_TOKEN_KEY);
	if (cached) return cached;

	const basic = btoa(`${env.BLIZZARD_CLIENT_ID}:${env.BLIZZARD_CLIENT_SECRET}`);

	const res = await fetch(OAUTH_URL, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basic}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});

	if (!res.ok) {
		throw new Error(`Blizzard OAuth failed: ${res.status} ${await res.text()}`);
	}

	const body = (await res.json()) as OAuthResponse;

	// Expire our copy a minute early so we never present a token mid-rotation.
	await env.CACHE.put(ACCESS_TOKEN_KEY, body.access_token, {
		expirationTtl: Math.max(60, body.expires_in - 60),
	});

	return body.access_token;
}

function fit(value: number, suffix: string, budget: number): string {
	for (let d = 2; d >= 0; d--) {
		const text = value.toFixed(d) + suffix;
		if (text.length <= budget) return text;
	}
	return Math.round(value) + suffix;
}

/**
 * Formats a gold amount to at most `budget` characters (6 by default,
 * which is what a SHORT_TEXT complication displays without truncating).
 *
 * The magnitude is chosen against the *rounded* value, so 999,999 becomes
 * "1.00m" rather than overflowing to "1000.0k".
 */
export function formatGold(gold: number, budget = 6): string {
	if (gold >= 999_500) return fit(gold / 1_000_000, 'm', budget);
	if (gold >= 1_000) return fit(gold / 1_000, 'k', budget);
	return String(Math.round(gold));
}

export async function fetchWowToken(env: {
	CACHE: KVNamespace;
	BLIZZARD_CLIENT_ID: string;
	BLIZZARD_CLIENT_SECRET: string;
}): Promise<WowTokenResult> {
	const accessToken = await getAccessToken(env);

	const res = await fetch(TOKEN_INDEX_URL, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Battlenet-Namespace': NAMESPACE,
		},
	});

	if (!res.ok) {
		throw new Error(`Blizzard token index failed: ${res.status} ${await res.text()}`);
	}

	const body = (await res.json()) as TokenIndexResponse;
	const gold = body.price / COPPER_PER_GOLD;

	return {
		value: formatGold(gold),
		gold,
		updated: body.last_updated_timestamp,
	};
}
