export interface QueryRequest {
    query: string;
    limit?: number;
}

export interface SourceInfo {
    table: string;
    section: string;
    source: string;
    distance: number;
}

export interface SearchResult {
    text: string;
    section: string;
    source: string;
    _table: string;
    _distance: number;
}

export interface QueryResponse {
    answer: string;
    sources: SourceInfo[];
    raw_results: SearchResult[];
}

export interface HealthResponse {
    status: "ok" | "degraded";
    tables_available?: number;
    error?: string;
    timestamp: string;
}

export interface TablesResponse {
    tables: string[];
}

export interface PluginSettings {
    apiBaseUrl: string;
    defaultResultLimit: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    apiBaseUrl: "http://localhost:3242",
    defaultResultLimit: 5,
};
