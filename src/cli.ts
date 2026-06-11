import { getDefaultCodexAuthFilePath } from "./codex-auth";
import { OpenAIModel } from "./llm";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_CODEX_MODEL = "gpt-5.4-mini";
const DEFAULT_CODEX_AUTH_FILE = getDefaultCodexAuthFilePath();

const [, , ...args] = Bun.argv;

let useCodexAuth = false;
let modelName: string | undefined;
let codexAuthFile = Bun.env["CODEX_AUTH_FILE"] ?? DEFAULT_CODEX_AUTH_FILE;
const promptParts: string[] = [];

for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    switch (arg) {
        case "--codex":
            useCodexAuth = true;
            break;
        case "--model":
            modelName = args[++index];
            break;
        case "--codex-auth-file":
            codexAuthFile = args[++index] ?? codexAuthFile;
            break;
        default:
            promptParts.push(arg);
    }
}

const prompt = promptParts.join(" ");
modelName ??= useCodexAuth ? DEFAULT_CODEX_MODEL : DEFAULT_OPENAI_MODEL;

if (!prompt) {
    console.error(
        "Usage: ts-agent [--codex] [--model <model>] [--codex-auth-file <path>] <prompt>",
    );
    console.error('Example: ts-agent --codex "say hello"');
    process.exit(1);
}

try {
    const model = useCodexAuth
        ? await OpenAIModel.fromAuthFile(modelName, codexAuthFile)
        : OpenAIModel.fromEnv(modelName);
    const response = await model.prompt(prompt);

    console.log(JSON.stringify(response, null, 2));
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
