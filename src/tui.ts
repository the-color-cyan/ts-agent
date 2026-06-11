import type { ModelInstance } from "./llm";

type Message = {
    role: "user" | "assistant" | "system";
    text: string;
};

class TinyTui {
    private messages: Message[] = [];
    private input: string = "";
    private loading = false;

    start(): void {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", this.onInput);
        this.render();
    }

    stop(): void {
        process.stdin.setRawMode(false);
        // ESC [ ? 25 h - show cursor
        process.stdout.write("\x1b[?25h\x1b[0m\n");
    }

    private render() {
        // ESC [ ? 25 l  - clear screen and hide cursor
        process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");

        // draw messages
        // draw prompt

        throw new Error("not yet implemented");
    }

    // used as callback thus written as arrow function to lexically capure this
    private onInput = async (data: Buffer) => {
        const s = data.toString();

        // ctrl-c
        if (s === "\x03") {
            this.stop();
            process.exit(0);
        }

        // enter
        if (s === "\r") {
            await this.submit();
            return;
        }

        // backspace
        if (s === "\x7f") {
            this.input = this.input.slice(0, -1);
            this.render();
            return;
        }

        this.input += s;
        this.render();
    };

    private async submit() {
        const prompt = this.input.trim();
        if (!prompt || this.loading) return;

        this.messages.push({ role: "user", text: prompt });

        this.input = "";
        this.loading = true;
        this.render();

        try {
            const response = await this.model.prompt(prompt);

            this.messages.push({
                role: "assistant",
                text: getResponseText(response),
            });
        } catch (e) {
            this.messages.push({
                role: "system",
                text: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
function getResponseText(response: any): string {
    throw new Error("Function not implemented.");
}
