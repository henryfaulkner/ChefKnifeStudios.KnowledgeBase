import { App, PluginSettingTab, Setting } from "obsidian";
import type DndKnowledgeBasePlugin from "./main";

export class SettingsTab extends PluginSettingTab {
    plugin: DndKnowledgeBasePlugin;

    constructor(app: App, plugin: DndKnowledgeBasePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "D&D Knowledge Base Settings" });

        new Setting(containerEl)
            .setName("API Base URL")
            .setDesc("URL of the local knowledge base server")
            .addText((text) =>
                text
                    .setPlaceholder("http://localhost:3242")
                    .setValue(this.plugin.settings.apiBaseUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.apiBaseUrl = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Result Limit")
            .setDesc("Maximum number of knowledge base results to retrieve")
            .addSlider((slider) =>
                slider
                    .setLimits(1, 20, 1)
                    .setValue(this.plugin.settings.defaultResultLimit)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.defaultResultLimit = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}
