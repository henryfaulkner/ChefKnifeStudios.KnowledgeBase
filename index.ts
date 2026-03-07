import * as lancedb from "@lancedb/lancedb";

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

async function runRAG(query: string) {
    const db = await lancedb.connect("./.kb_data");
    const tableName = "my_notes";
    const table = await db.openTable(tableName).catch(async () => {
        // Sample data to initialize the table schema
        return await db.createTable(tableName, [
            { id: 1, text: "Bun is a fast JS runtime", vector: Array(768).fill(0) }
        ]);
    });

    // 1. Get embedding for the query
    const queryVector = await getEmbedding(query);

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
            prompt: `Context:\n${contextText}\n\nQuestion: ${query}\n\nAnswer based ONLY on context:`,
            stream: false
        }),
    });
    
    const finalData: any = await chatRes.json();
    console.log("\n--- AI RESPONSE ---\n", finalData.response);
}

const userQuery = process.argv.slice(2).join(" ");
if (userQuery) await runRAG(userQuery);