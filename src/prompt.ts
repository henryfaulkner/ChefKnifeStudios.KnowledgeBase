import * as lancedb from "@lancedb/lancedb";

const queryArgOne = process.argv.slice(2).join(" ");

const OLLAMA_URL = "http://localhost:11434/api";

// Helper to get embeddings from Ollama
async function getEmbedding(text: string) {
    const res = await fetch(`${OLLAMA_URL}/embeddings`, {
        method: "POST",
        body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
    });
    const json: any = await res.json();
    return json.embedding;
}

const db = await lancedb.connect("./.kb_data");
const tableName = "dnd_5e_rules";
const table = await db.openTable(tableName);

// 1. Get embedding for the query
const queryVector = await getEmbedding(queryArgOne);

// 2. Search LanceDB
const contextResults = await table
    .vectorSearch(queryVector)
    .limit(3)
    .toArray();

const contextText = contextResults.map(r => r.text).join("\n---\n");

// 3. Generate Answer via Ollama (Inference)
const chatRes = await fetch(`${OLLAMA_URL}/generate`, {
    method: "POST",
    body: JSON.stringify({
        model: "qwen2.5:14b-instruct-q4_K_M", // or your preferred model
        prompt: `Context:\n${contextText}\n\nQuestion: ${queryArgOne}\n\nAnswer based ONLY on context:`,
        stream: false
    }),
});

const finalData: any = await chatRes.json();
console.log("\n--- AI RESPONSE ---\n", finalData.response);