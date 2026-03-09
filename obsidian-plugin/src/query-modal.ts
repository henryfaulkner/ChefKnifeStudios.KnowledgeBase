import { App, Modal, Setting } from "obsidian";

export class QueryModal extends Modal {
    private queryText: string = "";
    private onSubmit: (query: string) => void;

    constructor(app: App, onSubmit: (query: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Query D&D Knowledge Base" });

        new Setting(contentEl)
            .setName("Question")
            .setDesc("Ask about monsters, locations, NPCs, items, spells, or rules")
            .addText((text) => {
                text.setPlaceholder("e.g., What is a Beholder's eye ray?");
                text.onChange((value) => (this.queryText = value));
                text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
                    if (e.key === "Enter" && this.queryText.trim()) {
                        this.close();
                        this.onSubmit(this.queryText.trim());
                    }
                });
                setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText("Search")
                .setCta()
                .onClick(() => {
                    if (this.queryText.trim()) {
                        this.close();
                        this.onSubmit(this.queryText.trim());
                    }
                })
        );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
