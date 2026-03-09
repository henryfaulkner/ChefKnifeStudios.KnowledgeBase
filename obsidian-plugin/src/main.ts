import { Notice, Plugin } from "obsidian";
import { KnowledgeBaseClient } from "./api-client";
import { QueryModal } from "./query-modal";
import { ResultModal } from "./result-modal";
import { SettingsTab } from "./settings";
import { DEFAULT_SETTINGS, type PluginSettings } from "./types";

export default class DndKnowledgeBasePlugin extends Plugin {
    settings: PluginSettings = DEFAULT_SETTINGS;
    private client!: KnowledgeBaseClient;

    async onload(): Promise<void> {
        await this.loadSettings();
        this.client = new KnowledgeBaseClient(this.settings.apiBaseUrl);

        this.addCommand({
            id: "query-knowledge-base",
            name: "Query D&D Knowledge Base",
            callback: () => this.openQueryModal(),
        });

        this.addSettingTab(new SettingsTab(this.app, this));

        this.addRibbonIcon("book-open", "D&D Knowledge Base", () => {
            this.openQueryModal();
        });
    }

    private openQueryModal(): void {
        new QueryModal(this.app, async (query: string) => {
            await this.executeQuery(query);
        }).open();
    }

    private async executeQuery(query: string): Promise<void> {
        const modal = new ResultModal(this.app);
        modal.open();

        try {
            await this.client.queryStream(
                { query, limit: this.settings.defaultResultLimit },
                {
                    onSources: (sources) => modal.setSources(sources),
                    onToken: (token) => modal.appendToken(token),
                    onDone: () => modal.finalize(),
                    onError: (error) => {
                        new Notice(`Query error: ${error}`, 5000);
                    },
                }
            );
        } catch (err: any) {
            modal.close();

            if (err.message?.includes("ECONNREFUSED") || err.message?.includes("Failed to fetch")) {
                new Notice(
                    "Cannot reach knowledge base server. Is it running? (bun run start:server)",
                    8000
                );
            } else {
                new Notice(`Query failed: ${err.message}`, 5000);
            }
        }
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        this.client = new KnowledgeBaseClient(this.settings.apiBaseUrl);
    }
}
