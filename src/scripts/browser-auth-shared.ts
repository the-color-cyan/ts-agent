import { platform } from "node:process";

export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_AUTH_SCOPE =
	"openid profile email offline_access api.connectors.read api.connectors.invoke";
export const CODEX_ISSUER_URL = "https://auth.openai.com";
export const CODEX_CALLBACK_PORT = 1455;

export const CHATGPT_ME_URL = "https://chatgpt.com/backend-api/me";

export function buildCodexCallbackUrl(
	port: number,
	path = "/auth/callback",
): string {
	// Keep this redirect URI exactly aligned with Codex's Hydra allow-list.
	// The listener still binds 127.0.0.1, but OAuth registration expects localhost.
	return `http://localhost:${port}${path}`;
}

export async function openUrlInSystemBrowser(url: string): Promise<void> {
	const command =
		platform === "darwin"
			? ["open", url]
			: platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];

	const proc = Bun.spawn(command, {
		stdout: "inherit",
		stderr: "inherit",
	});

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`Failed to open ${url} in the system browser.`);
	}
}
