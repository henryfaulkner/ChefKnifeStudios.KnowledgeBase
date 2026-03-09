import { App, Component, MarkdownRenderer, Modal } from "obsidian";
import type { SourceInfo } from "./types";

export class ResultModal extends Modal {
    private component: Component;
    private answerDiv!: HTMLDivElement;
    private sourcesDetails!: HTMLDetailsElement;
    private sourcesList!: HTMLUListElement;
    private answerText: string = "";
    private renderTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(app: App) {
        super(app);
        this.component = new Component();
    }

    private toVaultPath(sourcePath: string): string {
        return sourcePath.replace(/^bin\//, "");
    }

    onOpen(): void {
        const { contentEl } = this;
        this.component.load();
        this.modalEl.addClass("kb-result-modal");

        // Answer area (initially shows loading indicator)
        this.answerDiv = contentEl.createDiv({ cls: "kb-answer" });
        this.answerDiv.createSpan({ cls: "kb-streaming-cursor", text: "Searching knowledge base..." });

        // Sources area (hidden until populated)
        this.sourcesDetails = contentEl.createEl("details", { cls: "kb-sources" });
        this.sourcesDetails.style.display = "none";
    }

    setSources(sources: SourceInfo[]): void {
        this.sourcesDetails.style.display = "";
        this.sourcesDetails.createEl("summary", {
            text: `Sources (${sources.length} results)`,
        });

        this.sourcesList = this.sourcesDetails.createEl("ul");
        for (const src of sources) {
            const li = this.sourcesList.createEl("li");
            const vaultPath = this.toVaultPath(src.source);

            const link = li.createEl("a", {
                cls: "kb-source-link",
                text: src.section,
                title: vaultPath,
            });
            link.addEventListener("click", (e) => {
                e.preventDefault();
                this.close();
                this.app.workspace.openLinkText(vaultPath, "", false);
            });

            li.createSpan({
                cls: "kb-source-meta",
                text: ` — ${src.table} (${src.distance.toFixed(4)})`,
            });
        }

        // Update the loading text now that we're about to stream
        this.answerDiv.empty();
        this.answerDiv.createSpan({ cls: "kb-streaming-cursor", text: "Generating response..." });
    }

    appendToken(token: string): void {
        this.answerText += token;
        this.debouncedRender();
    }

    private debouncedRender(): void {
        // Batch renders to avoid re-rendering markdown on every single token
        if (this.renderTimeout) return;
        this.renderTimeout = setTimeout(() => {
            this.renderTimeout = null;
            this.renderAnswer();
        }, 80);
    }

    private async renderAnswer(): Promise<void> {
        this.answerDiv.empty();
        await MarkdownRenderer.render(
            this.app,
            this.answerText,
            this.answerDiv,
            "",
            this.component
        );
    }

    async finalize(): Promise<void> {
        // Clear any pending debounce and do a final render
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
            this.renderTimeout = null;
        }
        await this.renderAnswer();
    }

    onClose(): void {
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }
        this.component.unload();
        this.contentEl.empty();
    }
}
