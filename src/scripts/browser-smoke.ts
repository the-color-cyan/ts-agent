import { CHATGPT_ME_URL } from "./browser-auth-shared";
import { getCodexAuthFilePath, readCodexAuthFile } from "../codex-auth";

try {
	const authFilePath = getCodexAuthFilePath();
	const tokens = await readCodexAuthFile(authFilePath);

	const response = await fetch(CHATGPT_ME_URL, {
		headers: {
			Authorization: `Bearer ${tokens.accessToken}`,
			"chatgpt-account-id": tokens.accountId,
			originator: "ts-agent",
		},
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		console.error(
			"Browser smoke check failed: stored auth file is not authenticated.",
		);
		console.error(`Status ${response.status}: ${response.statusText}`);
		if (body) {
			console.error(body.slice(0, 400));
		}
		process.exitCode = 1;
	} else {
		console.info(
			"Browser smoke check passed: stored Codex auth file is authenticated.",
		);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
