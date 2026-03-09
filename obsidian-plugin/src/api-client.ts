import { requestUrl } from "obsidian";
import type { QueryRequest, QueryResponse, HealthResponse, TablesResponse, SourceInfo } from "./types";

export interface StreamCallbacks {
    onSources: (sources: SourceInfo[]) => void;
    onToken: (token: string) => void;
    onDone: () => void;
    onError: (error: string) => void;
}

export class KnowledgeBaseClient {
    constructor(private baseUrl: string) {}

    async health(): Promise<HealthResponse> {
        const res = await requestUrl({ url: `${this.baseUrl}/health` });
        return res.json;
    }

    async tables(): Promise<TablesResponse> {
        const res = await requestUrl({ url: `${this.baseUrl}/tables` });
        return res.json;
    }

    async query(request: QueryRequest): Promise<QueryResponse> {
        const res = await requestUrl({
            url: `${this.baseUrl}/query`,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
        });

        if (res.status >= 400) {
            const error = res.json?.error || `API error: ${res.status}`;
            throw new Error(error);
        }

        return res.json;
    }

    async queryStream(request: QueryRequest, callbacks: StreamCallbacks): Promise<void> {
        // Use fetch (not requestUrl) because we need streaming
        const res = await fetch(`${this.baseUrl}/query/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
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
                    // skip malformed events
                }
            }
        }
    }
}
