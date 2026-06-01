# ts-agent
TypeScript agent harness

## App-owned Codex OAuth flow

This repo includes a lightweight flow for acquiring Codex OAuth credentials into a local
`~/.ts-agent/auth.json` file.

### Scripts

- `bun run browser:auth` — performs a standard Codex ChatGPT OAuth authorization-code + PKCE flow in your system browser and writes auth tokens to the app auth file.
- `bun run browser:smoke` — verifies that the stored auth file currently authenticates against `https://chatgpt.com/backend-api/me`.
- `bun run typecheck` — runs `bunx tsc --noEmit`.

`browser:auth` uses:
- client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
- issuer: `https://auth.openai.com`
- callback URL: `http://localhost:1455/auth/callback`
- PKCE + CSRF state validation

### Codex auth file precedence

- Default path: `~/.ts-agent/auth.json`
- Override: `CODEX_AUTH_FILE`

You can also explicitly pass a file path:

```sh
bun run src/cli.ts --codex --codex-auth-file /path/to/auth.json "say hi"
```

### Run OAuth login

```sh
bun run browser:auth
```

After approval, the script writes credentials into your auth file and exits. It does not print token material.

### Verify stored auth

```sh
bun run browser:smoke
```

If the auth file is missing or stale, this command exits non-zero.

`browser:smoke` only checks the app-owned auth file; it no longer attaches to Chrome via CDP.
