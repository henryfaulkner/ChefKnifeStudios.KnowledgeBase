import * as lancedb from "@lancedb/lancedb";
import { Glob } from "bun";

const OLLAMA_URL = "http://localhost:11434/api";

async function getEmbedding(text: string): Promise<number[]> {
    const res = await fetch(`${OLLAMA_URL}/embeddings`, {
        method: "POST",
        body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
    });
    const json: any = await res.json();
    return json.embedding;
}

interface RulesRecord {
    [key: string]: unknown;
    id: number;
    text: string;
    vector: number[];
}

const RULES_DIR = "bin/dnd-5e-rules";

function getRulesFilePaths(): string[] {
    const glob = new Glob("**/*");
    return Array.from(glob.scanSync(RULES_DIR)).map(f => `${RULES_DIR}/${f}`);
}

async function processRulesTable(records: RulesRecord[]): Promise<void> {
    const db = await lancedb.connect("./.kb_data");
    const tableName = "dnd_5e_rules";
    await db.openTable(tableName).catch(async () => {
        return await db.createTable(tableName, records);
    });
}

async function executeProcess(): Promise<void> {
    var filePaths = getRulesFilePaths();
    var rulesRecords = await Promise.all(
        filePaths.map(async (rfp, i) => {
            const content = await Bun.file(rfp).text();
            const vector = await getEmbedding(content);
            return { id: i, text: content, vector };
        })
    );
    await processRulesTable(rulesRecords);
}

const db = await lancedb.connect("./.kb_data");
await db.dropAllTables()
await executeProcess();