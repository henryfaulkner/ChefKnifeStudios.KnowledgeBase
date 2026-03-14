import * as lancedb from "@lancedb/lancedb";

const queryArgOne = process.argv.slice(2).join(" ");

const OLLAMA_URL = "http://localhost:11434/api";

async function getEmbedding(text: string) {
    const res = await fetch(`${OLLAMA_URL}/embeddings`, {
        method: "POST",
        body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
    });
    const json: any = await res.json();
    return json.embedding;
}

const db = await lancedb.connect("./.kb_data");
const tableNames = await db.tableNames();

// 1. Get embedding for the query
const queryVector = await getEmbedding(queryArgOne);

// 2. Search all tables in parallel, merge results by distance
const allResults = await Promise.all(
    tableNames.map(async (name) => {
        const table = await db.openTable(name);
        const results = await table
            .vectorSearch(queryVector)
            .limit(5)
            .toArray();
        return results.map(r => ({ ...r, _table: name }));
    })
);

const merged = allResults
    .flat()
    .sort((a, b) => (a._distance as number) - (b._distance as number))
    .slice(0, 5);

// 3. Build context with source attribution
const contextText = merged
    .map(r => `[Source: ${r._table} | ${r.section}]\n${r.text}`)
    .join("\n---\n");

console.log(`\n--- Sources (${merged.length} results from ${tableNames.length} tables) ---`);
for (const r of merged) {
    console.log(`  ${r._table} > ${r.section} (distance: ${(r._distance as number).toFixed(4)})`);
}

// 4. Generate Answer via Ollama
const systemPrompt = `You are a D&D 5e reference assistant for Dungeon Masters. Answer questions using ONLY the provided context. Never invent information not present in the context.

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

const chatRes = await fetch(`${OLLAMA_URL}/generate`, {
    method: "POST",
    body: JSON.stringify({
        model: "qwen2.5:14b-instruct-q4_K_M",
        system: systemPrompt,
        prompt: `Context:\n${contextText}\n\nQuestion: ${queryArgOne}`,
        stream: false
    }),
});

const finalData: any = await chatRes.json();
console.log("\n--- AI RESPONSE ---\n", finalData.response);
