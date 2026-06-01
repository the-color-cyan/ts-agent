import { createHash, randomBytes } from "node:crypto";

import {
	CODEX_CALLBACK_PORT,
	CODEX_CLIENT_ID,
	CODEX_ISSUER_URL,
	CODEX_AUTH_SCOPE,
	buildCodexCallbackUrl,
	openUrlInSystemBrowser,
} from "./browser-auth-shared";
import {
	type CodexAuthTokens,
	getCodexAuthFilePath,
	writeCodexAuthFile,
} from "../codex-auth";

const AUTH_TIMEOUT_MS = 15 * 60_000;

function base64UrlEncode(bytes: Buffer): string {
	return bytes
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function generateCodeVerifier(): string {
	return base64UrlEncode(randomBytes(48));
}

function generateCodeChallenge(verifier: string): string {
	return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

function generateState(): string {
	return base64UrlEncode(randomBytes(16));
}

type AuthUrlParams = {
	code: string;
	state: string;
	redirectUri: string;
};

function buildAuthorizeUrl({
	code,
	state,
	redirectUri,
}: AuthUrlParams): string {
	const baseUrl = `${CODEX_ISSUER_URL}/oauth/authorize`;
	const params = new URLSearchParams({
		response_type: "code",
		client_id: CODEX_CLIENT_ID,
		redirect_uri: redirectUri,
		scope: CODEX_AUTH_SCOPE,
		code_challenge: code,
		code_challenge_method: "S256",
		state,
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
		originator: "ts-agent",
	});

	return `${baseUrl}?${params}`;
}

function decodeJwtPayload<T = Record<string, unknown>>(token: string): T {
	const [, payload] = token.split(".");
	if (!payload) {
		throw new Error("Unable to parse account information from token response.");
	}

	const fixed = payload.replace(/-/g, "+").replace(/_/g, "/");
	const padded = fixed + "=".repeat((4 - (fixed.length % 4)) % 4);
	const json = Buffer.from(padded, "base64").toString("utf8");

	return JSON.parse(json) as T;
}

function extractAccountIdFromIdToken(idToken: string): string {
	const payload = decodeJwtPayload<{
		"https://api.openai.com/auth"?: {
			chatgpt_account_id?: string;
		};
		chatgpt_account_id?: string;
	}>(idToken);
	const accountId =
		payload["https://api.openai.com/auth"]?.chatgpt_account_id ??
		payload.chatgpt_account_id;
	if (!accountId || accountId.length === 0) {
		throw new Error(
			"OAuth token response did not include chatgpt_account_id in the ID token auth claims.",
		);
	}

	return accountId;
}

async function waitForAuthorizationCode(
	port: number,
	state: string,
	timeoutMs: number,
): Promise<string> {
	const callbackPath = "/auth/callback";
	const redirectUri = buildCodexCallbackUrl(port, callbackPath);
	let server: ReturnType<typeof Bun.serve> | undefined;

	const codePromise = new Promise<string>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(
				new Error(
					`Timed out waiting for browser authorization callback at ${redirectUri}.`,
				),
			);
		}, timeoutMs);

		server = Bun.serve({
			hostname: "127.0.0.1",
			port,
			async fetch(request) {
				const reqUrl = new URL(request.url);

				if (reqUrl.pathname !== callbackPath) {
					return new Response("Not found", { status: 404 });
				}

				const error = reqUrl.searchParams.get("error");
				if (error) {
					clearTimeout(timeout);
					reject(new Error(`Authorization callback returned error: ${error}`));
					return new Response("Authentication failed.", { status: 400 });
				}

				const returnedState = reqUrl.searchParams.get("state") ?? "";
				if (returnedState !== state) {
					clearTimeout(timeout);
					reject(new Error("OAuth state parameter mismatch."));
					return new Response("Authentication failed.", { status: 400 });
				}

				const code = reqUrl.searchParams.get("code");
				if (!code) {
					clearTimeout(timeout);
					reject(new Error("No authorization code found in callback request."));
					return new Response("Authentication failed.", { status: 400 });
				}

				clearTimeout(timeout);
				resolve(code);
				return new Response(
					"Authentication complete. You may return to the terminal.",
				);
			},
		});
	});

	try {
		return await codePromise;
	} finally {
		server?.stop();
	}
}

async function exchangeAuthorizationCode(params: {
	code: string;
	codeVerifier: string;
	redirectUri: string;
}): Promise<CodexAuthTokens> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		client_id: CODEX_CLIENT_ID,
		redirect_uri: params.redirectUri,
		code: params.code,
		code_verifier: params.codeVerifier,
	});

	const response = await fetch(`${CODEX_ISSUER_URL}/oauth/token`, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
		},
		body: body.toString(),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(
			`OAuth token exchange failed (${response.status}): ${text}`,
		);
	}

	const payload = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		id_token?: string;
	};

	const accessToken = payload.access_token;
	const refreshToken = payload.refresh_token;
	const idToken = payload.id_token;

	if (!accessToken || !refreshToken || !idToken) {
		throw new Error(
			"OAuth token response did not include required fields (access_token, refresh_token, id_token).",
		);
	}

	const accountId = extractAccountIdFromIdToken(idToken);
	return { accessToken, refreshToken, accountId };
}

try {
	const authFilePath = getCodexAuthFilePath();
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = generateCodeChallenge(codeVerifier);
	const state = generateState();
	const redirectUri = buildCodexCallbackUrl(CODEX_CALLBACK_PORT);
	const authorizeUrl = buildAuthorizeUrl({
		code: codeChallenge,
		state,
		redirectUri,
	});

	const codePromise = waitForAuthorizationCode(
		CODEX_CALLBACK_PORT,
		state,
		AUTH_TIMEOUT_MS,
	);

	await openUrlInSystemBrowser(authorizeUrl);
	console.info("Opened ChatGPT OAuth login in your system browser.");
	console.info(`After signing in, you should be redirected to ${redirectUri}.`);

	const code = await codePromise;
	const tokens = await exchangeAuthorizationCode({
		code,
		codeVerifier,
		redirectUri,
	});
	await writeCodexAuthFile(authFilePath, tokens);

	console.info(`Codex auth saved to ${authFilePath}`);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
