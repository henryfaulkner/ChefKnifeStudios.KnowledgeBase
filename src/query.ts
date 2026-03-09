import * as lancedb from "@lancedb/lancedb";
import { getEmbedding } from "./embedding";
import {
    OLLAMA_URL,
    GENERATION_MODEL,
    KB_DATA_PATH,
    DEFAULT_RESULT_LIMIT,
} from "./config";

// --- Types ---

export interface SearchResult {
    text: string;
    section: string;
    source: string;
    _table: string;
    _distance: number;
}

export interface QueryResponse {
    answer: string;
    sources: Array<{
        table: string;
        section: string;
        distance: number;
    }>;
    raw_results: SearchResult[];
}

// --- System Prompt ---

const SYSTEM_PROMPT = `You are a D&D 5e reference assistant for Dungeon Masters. Answer questions using ONLY the provided context. Never invent information not present in the context.

Detect the content type from context and adapt your response format:

**MONSTER/CREATURE** — Use this format:
# [Name]
**Type:** [creature type, size, alignment]
**AC:** [value] | **HP:** [value] | **Speed:** [value]
**Stats:** STR [x] DEX [x] CON [x] INT [x] WIS [x] CHA [x]
**CR:** [value] | **XP:** [value]

**Key Abilities:** [list notable traits, resistances, immunities]
**Actions:** [list attacks with to-hit and damage]
**Tactics:** [how this creature fights, based on context]

**LOCATION** — Use this format:
# [Name]
**Type:** [dungeon, town, wilderness, building, etc.]
**Key Features:** [notable elements, hazards, terrain]
**Encounters:** [creatures/NPCs found here]
**Treasure:** [loot, items of interest]
**Connections:** [leads to/from other locations]
**DM Notes:** [traps, secrets, things to remember]

**NPC** — Use this format:
# [Name]
**Role:** [occupation, title, faction]
**Location:** [where they are found]
**Personality:** [traits, ideals, bonds, flaws]
**Motivation:** [what they want]
**Dialogue Hooks:** [conversation starters, key info they share]
**Combat:** [stats if hostile, or "non-combatant"]

**ITEM/EQUIPMENT** — Use this format:
# [Name]
**Type:** [weapon, armor, wondrous item, potion, etc.]
**Rarity:** [if known]
**Attunement:** [yes/no, requirements]
**Properties:** [effects, bonuses, charges]
**Description:** [appearance, lore]

**SPELL/RULE/OTHER** — Use this format:
# [Name]
[Structured answer with relevant details]

---
After the main response, ALWAYS include:
**Sources:** [list the [Source: ...] tags from context]
**See Also:** [suggest 2-3 related topics the DM might want to look up next]`;

// --- Database Connection (lazy singleton) ---

let dbInstance: lancedb.Connection | null = null;

async function getDb(): Promise<lancedb.Connection> {
    if (!dbInstance) {
        dbInstance = await lancedb.connect(KB_DATA_PATH);
    }
    return dbInstance;
}

// --- Exported Functions ---

export async function getTableNames(): Promise<string[]> {
    const db = await getDb();
    return db.tableNames();
}

export async function searchKnowledgeBase(
    queryText: string,
    limit: number = DEFAULT_RESULT_LIMIT
): Promise<SearchResult[]> {
    const t0 = performance.now();

    const db = await getDb();
    const tableNames = await db.tableNames();

    const t1 = performance.now();
    const queryVector = await getEmbedding(queryText);

    const t2 = performance.now();
    const allResults = await Promise.all(
        tableNames.map(async (name) => {
            const table = await db.openTable(name);
            const results = await table
                .vectorSearch(queryVector)
                .limit(limit)
                .toArray();
            return results.map((r: any) => ({
                text: r.text as string,
                section: r.section as string,
                source: r.source as string,
                _table: name,
                _distance: r._distance as number,
            }));
        })
    );

    const t3 = performance.now();
    console.log(`[perf] DB connect + table names: ${(t1 - t0).toFixed(0)}ms`);
    console.log(`[perf] Query embedding:          ${(t2 - t1).toFixed(0)}ms`);
    console.log(`[perf] Vector search (${tableNames.length} tables): ${(t3 - t2).toFixed(0)}ms`);

    return allResults
        .flat()
        .sort((a, b) => a._distance - b._distance)
        .slice(0, limit);
}

export function buildContext(results: SearchResult[]): string {
    return results
        .map((r) => `[Source: ${r._table} | ${r.section}]\n${r.text}`)
        .join("\n---\n");
}

export async function generateAnswer(
    query: string,
    context: string
): Promise<string> {
    const t0 = performance.now();
    const res = await fetch(`${OLLAMA_URL}/generate`, {
        method: "POST",
        body: JSON.stringify({
            model: GENERATION_MODEL,
            system: SYSTEM_PROMPT,
            prompt: `Context:\n${context}\n\nQuestion: ${query}`,
            stream: false,
        }),
    });

    if (!res.ok) {
        throw new Error(`Generation request failed: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    const t1 = performance.now();
    console.log(`[perf] LLM inference:            ${(t1 - t0).toFixed(0)}ms`);
    return data.response;
}

export async function generateAnswerStream(
    query: string,
    context: string
): Promise<Response> {
    const res = await fetch(`${OLLAMA_URL}/generate`, {
        method: "POST",
        body: JSON.stringify({
            model: GENERATION_MODEL,
            system: SYSTEM_PROMPT,
            prompt: `Context:\n${context}\n\nQuestion: ${query}`,
            stream: true,
        }),
    });

    if (!res.ok) {
        throw new Error(`Generation request failed: ${res.status} ${res.statusText}`);
    }

    return res;
}

export async function queryKnowledgeBase(
    query: string,
    limit: number = DEFAULT_RESULT_LIMIT
): Promise<QueryResponse> {
    const tTotal = performance.now();
    const results = await searchKnowledgeBase(query, limit);
    const context = buildContext(results);
    const answer = await generateAnswer(query, context);
    console.log(`[perf] Total query time:         ${(performance.now() - tTotal).toFixed(0)}ms`);

    return {
        answer,
        sources: results.map((r) => ({
            table: r._table,
            section: r.section,
            source: r.source,
            distance: r._distance,
        })),
        raw_results: results,
    };
}
