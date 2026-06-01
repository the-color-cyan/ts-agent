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
        const tokens: CodexOAuthTokens =
            raw.tokens ?? raw["openai-codex"] ?? raw;
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

export enum ResponseUrl {
    OpenAI = "https://api.openai.com/v1/responses",
    Codex = "https://chatgpt.com/backend-api/codex/responses",
}

export class OpenAIModel {
    constructor(
        private auth: AuthProvider,
        private model: string,
        private responseUrl: ResponseUrl,
    ) {}

    static fromEnv(model: string) {
        const apiKey = ApiKeyAuth.fromEnv("OPENAI_API_KEY");
        return new OpenAIModel(apiKey, model, ResponseUrl.OpenAI);
    }

    static async fromCodexAuthFile(model: string, path: string) {
        return new OpenAIModel(
            await CodexAuth.fromFile(path),
            model,
            ResponseUrl.Codex,
        );
    }

    //TODO: specify unknown Promise contents
    async prompt(input: string): Promise<unknown> {
        const headers = new Headers({ "content-type": "application/json" });

        await this.auth.applyAuth(headers);

        const response = await fetch(this.responseUrl, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(this.buildRequestBody(input)),
        });

        const text = await response.text();

        if (!response.ok) {
            throw new Error(
                `OpenAI API error ${response.status} ${response.statusText}: ${text}`,
            );
        }

        if (this.responseUrl === ResponseUrl.Codex) {
            return parseCodexSseResponse(text);
        }

        return JSON.parse(text);
    }

    private buildRequestBody(input: string) {
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

// codex specific
function parseCodexSseResponse(sseText: string): ModelResponse {
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

// {
//   "text": "Test received.",
//   "response": {
//     "id": "resp_08f68d9542eec6cf016a1d6dd2cdd88190a58827d073f71ebb",
//     "object": "response",
//     "created_at": 1780313554,
//     "status": "completed",
//     "background": false,
//     "completed_at": 1780313555,
//     "error": null,
//     "frequency_penalty": 0,
//     "incomplete_details": null,
//     "instructions": "You are a helpful assistant.",
//     "max_output_tokens": null,
//     "max_tool_calls": null,
//     "model": "gpt-5.4-mini-2026-03-17",
//     "moderation": null,
//     "parallel_tool_calls": true,
//     "presence_penalty": 0,
//     "previous_response_id": null,
//     "prompt_cache_key": "6f52d283-0259-4e9a-aa18-4b28733629f0",
//     "prompt_cache_retention": "24h",
//     "reasoning": {
//       "context": "current_turn",
//       "effort": "none",
//       "summary": null
//     },
//     "safety_identifier": "user-R9pa6btsQMBj5zzKM6BL7gJg",
//     "service_tier": "default",
//     "store": false,
//     "temperature": 1,
//     "text": {
//       "format": {
//         "type": "text"
//       },
//       "verbosity": "low"
//     },
//     "tool_choice": "auto",
//     "tool_usage": {
//       "image_gen": {
//         "input_tokens": 0,
//         "input_tokens_details": {
//           "image_tokens": 0,
//           "text_tokens": 0
//         },
//         "output_tokens": 0,
//         "output_tokens_details": {
//           "image_tokens": 0,
//           "text_tokens": 0
//         },
//         "total_tokens": 0
//       },
//       "web_search": {
//         "num_requests": 0
//       }
//     },
//     "tools": [],
//     "top_logprobs": 0,
//     "top_p": 0.98,
//     "truncation": "disabled",
//     "usage": {
//       "input_tokens": 17,
//       "input_tokens_details": {
//         "cached_tokens": 0
//       },
//       "output_tokens": 7,
//       "output_tokens_details": {
//         "reasoning_tokens": 0
//       },
//       "total_tokens": 24
//     },
//     "user": null,
//     "metadata": {}
//   }
// }
