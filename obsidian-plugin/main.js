"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => DndKnowledgeBasePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");

// src/api-client.ts
var import_obsidian = require("obsidian");
var KnowledgeBaseClient = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  async health() {
    const res = await (0, import_obsidian.requestUrl)({ url: `${this.baseUrl}/health` });
    return res.json;
  }
  async tables() {
    const res = await (0, import_obsidian.requestUrl)({ url: `${this.baseUrl}/tables` });
    return res.json;
  }
  async query(request) {
    const res = await (0, import_obsidian.requestUrl)({
      url: `${this.baseUrl}/query`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    if (res.status >= 400) {
      const error = res.json?.error || `API error: ${res.status}`;
      throw new Error(error);
    }
    return res.json;
  }
  async queryStream(request, callbacks) {
    const res = await fetch(`${this.baseUrl}/query/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `API error: ${res.status}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const eventMatch = part.match(/^event: (\w+)\ndata: (.+)$/s);
        if (!eventMatch) continue;
        const [, event, data] = eventMatch;
        try {
          switch (event) {
            case "sources":
              callbacks.onSources(JSON.parse(data));
              break;
            case "token":
              callbacks.onToken(JSON.parse(data));
              break;
            case "done":
              callbacks.onDone();
              break;
            case "error":
              callbacks.onError(JSON.parse(data));
              break;
          }
        } catch {
        }
      }
    }
  }
};

// src/query-modal.ts
var import_obsidian2 = require("obsidian");
var QueryModal = class extends import_obsidian2.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.queryText = "";
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Query D&D Knowledge Base" });
    new import_obsidian2.Setting(contentEl).setName("Question").setDesc("Ask about monsters, locations, NPCs, items, spells, or rules").addText((text) => {
      text.setPlaceholder("e.g., What is a Beholder's eye ray?");
      text.onChange((value) => this.queryText = value);
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && this.queryText.trim()) {
          this.close();
          this.onSubmit(this.queryText.trim());
        }
      });
      setTimeout(() => text.inputEl.focus(), 50);
    });
    new import_obsidian2.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Search").setCta().onClick(() => {
        if (this.queryText.trim()) {
          this.close();
          this.onSubmit(this.queryText.trim());
        }
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/result-modal.ts
var import_obsidian3 = require("obsidian");
var ResultModal = class extends import_obsidian3.Modal {
  constructor(app) {
    super(app);
    this.answerText = "";
    this.renderTimeout = null;
    this.component = new import_obsidian3.Component();
  }
  toVaultPath(sourcePath) {
    return sourcePath.replace(/^bin\//, "");
  }
  onOpen() {
    const { contentEl } = this;
    this.component.load();
    this.modalEl.addClass("kb-result-modal");
    this.answerDiv = contentEl.createDiv({ cls: "kb-answer" });
    this.answerDiv.createSpan({ cls: "kb-streaming-cursor", text: "Searching knowledge base..." });
    this.sourcesDetails = contentEl.createEl("details", { cls: "kb-sources" });
    this.sourcesDetails.style.display = "none";
  }
  setSources(sources) {
    this.sourcesDetails.style.display = "";
    this.sourcesDetails.createEl("summary", {
      text: `Sources (${sources.length} results)`
    });
    this.sourcesList = this.sourcesDetails.createEl("ul");
    for (const src of sources) {
      const li = this.sourcesList.createEl("li");
      const vaultPath = this.toVaultPath(src.source);
      const link = li.createEl("a", {
        cls: "kb-source-link",
        text: src.section,
        title: vaultPath
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.close();
        this.app.workspace.openLinkText(vaultPath, "", false);
      });
      li.createSpan({
        cls: "kb-source-meta",
        text: ` \u2014 ${src.table} (${src.distance.toFixed(4)})`
      });
    }
    this.answerDiv.empty();
    this.answerDiv.createSpan({ cls: "kb-streaming-cursor", text: "Generating response..." });
  }
  appendToken(token) {
    this.answerText += token;
    this.debouncedRender();
  }
  debouncedRender() {
    if (this.renderTimeout) return;
    this.renderTimeout = setTimeout(() => {
      this.renderTimeout = null;
      this.renderAnswer();
    }, 80);
  }
  async renderAnswer() {
    this.answerDiv.empty();
    await import_obsidian3.MarkdownRenderer.render(
      this.app,
      this.answerText,
      this.answerDiv,
      "",
      this.component
    );
  }
  async finalize() {
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    await this.renderAnswer();
  }
  onClose() {
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
    }
    this.component.unload();
    this.contentEl.empty();
  }
};

// src/settings.ts
var import_obsidian4 = require("obsidian");
var SettingsTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "D&D Knowledge Base Settings" });
    new import_obsidian4.Setting(containerEl).setName("API Base URL").setDesc("URL of the local knowledge base server").addText(
      (text) => text.setPlaceholder("http://localhost:3242").setValue(this.plugin.settings.apiBaseUrl).onChange(async (value) => {
        this.plugin.settings.apiBaseUrl = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Result Limit").setDesc("Maximum number of knowledge base results to retrieve").addSlider(
      (slider) => slider.setLimits(1, 20, 1).setValue(this.plugin.settings.defaultResultLimit).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.defaultResultLimit = value;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/types.ts
var DEFAULT_SETTINGS = {
  apiBaseUrl: "http://localhost:3242",
  defaultResultLimit: 5
};

// src/main.ts
var DndKnowledgeBasePlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    this.client = new KnowledgeBaseClient(this.settings.apiBaseUrl);
    this.addCommand({
      id: "query-knowledge-base",
      name: "Query D&D Knowledge Base",
      callback: () => this.openQueryModal()
    });
    this.addSettingTab(new SettingsTab(this.app, this));
    this.addRibbonIcon("book-open", "D&D Knowledge Base", () => {
      this.openQueryModal();
    });
  }
  openQueryModal() {
    new QueryModal(this.app, async (query) => {
      await this.executeQuery(query);
    }).open();
  }
  async executeQuery(query) {
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
            new import_obsidian5.Notice(`Query error: ${error}`, 5e3);
          }
        }
      );
    } catch (err) {
      modal.close();
      if (err.message?.includes("ECONNREFUSED") || err.message?.includes("Failed to fetch")) {
        new import_obsidian5.Notice(
          "Cannot reach knowledge base server. Is it running? (bun run start:server)",
          8e3
        );
      } else {
        new import_obsidian5.Notice(`Query failed: ${err.message}`, 5e3);
      }
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.client = new KnowledgeBaseClient(this.settings.apiBaseUrl);
  }
};
