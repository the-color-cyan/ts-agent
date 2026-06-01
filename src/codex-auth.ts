import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { chmod, mkdir } from "node:fs/promises";

export const CODEX_AUTH_FILE_ENV = "CODEX_AUTH_FILE";
export const DEFAULT_CODEX_AUTH_FILE = resolve(
	homedir(),
	".ts-agent",
	"auth.json",
);

export interface CodexAuthTokens {
	accessToken: string;
	refreshToken: string;
	accountId: string;
}

export function getDefaultCodexAuthFilePath(): string {
	return Bun.env[CODEX_AUTH_FILE_ENV] ?? DEFAULT_CODEX_AUTH_FILE;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function getStringField(
	record: Record<string, unknown>,
	...keys: string[]
): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}

	return undefined;
}

function extractTokens(
	record: Record<string, unknown> | undefined,
): CodexAuthTokens | undefined {
	if (!record) return undefined;

	const accessToken = getStringField(record, "access_token", "access");
	const refreshToken = getStringField(record, "refresh_token", "refresh");
	const accountId = getStringField(record, "account_id", "accountId");

	if (!accessToken || !refreshToken || !accountId) {
		return undefined;
	}

	return { accessToken, refreshToken, accountId };
}

export function getCodexAuthFilePath(override?: string): string {
	return override || getDefaultCodexAuthFilePath();
}

export async function readCodexAuthFile(
	path: string,
): Promise<CodexAuthTokens> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(
			`Auth file not found at ${path}. Run: bun run browser:auth`,
		);
	}

	const raw = await file.json();
	const root = asRecord(raw);
	if (!root) {
		throw new Error(`Auth file at ${path} is not valid JSON object format.`);
	}

	const fromTokens = extractTokens(asRecord(root["tokens"]));
	const fromOpenaiCodex = extractTokens(asRecord(root["openai-codex"]));
	const tokens = fromTokens ?? fromOpenaiCodex ?? extractTokens(root);

	if (!tokens) {
		throw new Error(
			`Auth file at ${path} must contain access, refresh, and accountId.`,
		);
	}

	return tokens;
}

export async function writeCodexAuthFile(
	path: string,
	tokens: CodexAuthTokens,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await chmod(dirname(path), 0o700).catch(() => undefined);

	const payload = {
		"openai-codex": {
			type: "chatgpt",
			access: tokens.accessToken,
			refresh: tokens.refreshToken,
			accountId: tokens.accountId,
			access_token: tokens.accessToken,
			refresh_token: tokens.refreshToken,
			account_id: tokens.accountId,
		},
	};

	await Bun.write(path, `${JSON.stringify(payload, null, 2)}\n`);
	await chmod(path, 0o600);
}
