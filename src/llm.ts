export interface AuthProvider {
    applyAuth(headers: Headers): Promise<void> | void;
}

export class ApiKeyAuth implements AuthProvider {
    constructor(private apiKey: string) {}

    static fromEnv(name: string) {
        const apiKey = Bun.env[name];
        if (!apiKey) throw new Error(`${name} environment variable not set.`);

        return new ApiKeyAuth(apiKey);
    }

    applyAuth(headers: Headers) {
        headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
}

export type CodexOAuthTokens = {
    access?: string;
    refresh?: string;
    accountId?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
};

type CodexAuthFile = {
    tokens?: CodexOAuthTokens;
    "openai-codex"?: CodexOAuthTokens;
};

export class CodexAuth implements AuthProvider {
    constructor(
        private accessToken: string,
        private accountId: string,
    ) {}

    static async fromFile(path: string) {
        const raw = (await Bun.file(path).json()) as CodexAuthFile &
            CodexOAuthTokens;
        const tokens: CodexOAuthTokens = raw.tokens ?? raw["openai-codex"] ?? raw;
        const accessToken = tokens.access_token ?? tokens.access;
        const accountId = tokens.account_id ?? tokens.accountId;

        if (!accessToken || !accountId) {
            throw new Error(
                `Codex auth file ${path} did not contain access/accountId credentials.`,
            );
        }

        return new CodexAuth(accessToken, accountId);
    }

    applyAuth(headers: Headers) {
        headers.set("Authorization", `Bearer ${this.accessToken}`);
        headers.set("chatgpt-account-id", this.accountId);
        headers.set("originator", "ts-agent");
        headers.set("OpenAI-Beta", "responses=experimental");
        headers.set("accept", "text/event-stream");
    }
}

export interface TokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}

export interface ModelResponse {
    text: string;
    provider: "openai" | "codex";
    id?: string;
    model?: string;
    status?: string;
    usage?: TokenUsage;
    raw?: unknown;
}

enum ResponseUrl {
    OpenAI = "https://api.openai.com/v1/responses",
    Codex = "https://chatgpt.com/backend-api/codex/responses",
}

export interface ModelInstance {
    prompt(input: string): Promise<unknown>;
}

export abstract class BaseModel implements ModelInstance {
    protected constructor(
        protected auth: AuthProvider,
        protected model: string,
        protected responseUrl: ResponseUrl,
    ) {
    }

    //TODO: specify unknown Promise contents
    async prompt(input: string): Promise<unknown> {
        const headers = new Headers({"content-type": "application/json"});
        await this.auth.applyAuth(headers);

        const response = await fetch(this.responseUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(this.buildRequestBody(input)),
        });

        const text = await response.text();

        if (!response.ok) {
            throw new Error(
                `Model API error ${response.status} ${response.statusText}: ${text}`,
            );
        }

        return this.parseResponse(text);
    }

    protected abstract buildRequestBody(input: string): unknown;

    protected abstract parseResponse(text: string): unknown;
}

export class OpenAIModel extends BaseModel {
    static fromEnv(model: string): OpenAIModel {
        const apiKey = ApiKeyAuth.fromEnv("OPENAI_API_KEY");
        return new OpenAIModel(apiKey, model, ResponseUrl.OpenAI);
    }

    static async fromAuthFile(model: string, path: string) {
        return new OpenAIModel(
            await CodexAuth.fromFile(path),
            model,
            ResponseUrl.Codex,
        );
    }

    protected buildRequestBody(input: string) {
        if (this.responseUrl !== ResponseUrl.Codex) {
            return { model: this.model, input };
        }

        return {
            model: this.model,
            store: false,
            stream: true,
            instructions: "You are a helpful assistant.",
            input: [
                {
                    role: "user",
                    content: [{ type: "input_text", text: input }],
                },
            ],
            text: { verbosity: "low" },
            reasoning: { effort: "none" },
        };
    }

    // TODO: move to Codex specific Class
    protected parseResponse(sseText: string): ModelResponse {
        let outputText = "";
        let completedResponse: CodexCompletedResponse | undefined;

        for (const line of sseText.split("\n")) {
            if (!line.startsWith("data: ")) continue;

            const event = JSON.parse(line.slice("data: ".length)) as CodexSseEvent;

            if (event.type === "response.output_text.delta") {
                outputText += event.delta ?? "";
            }

            if (event.type === "response.completed") {
                completedResponse = event.response;
            }
        }

        return {
            text: outputText,
            provider: "codex",
            id: completedResponse?.id,
            model: completedResponse?.model,
            status: completedResponse?.status,
            usage: completedResponse?.usage
                ? {
                    inputTokens: completedResponse.usage.input_tokens,
                    outputTokens: completedResponse.usage.output_tokens,
                    totalTokens: completedResponse.usage.total_tokens,
                }
                : undefined,
            raw: completedResponse,
        };
    }
}

type CodexCompletedResponse = {
    id?: string;
    model?: string;
    status?: string;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
    };
};

type CodexSseEvent = {
    type?: string;
    delta?: string;
    response?: CodexCompletedResponse;
};

