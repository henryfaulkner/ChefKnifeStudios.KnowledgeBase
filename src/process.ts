import * as lancedb from "@lancedb/lancedb";
import { Glob } from "bun";
import path from "path";

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
    source: string;
    section: string;
}

interface Chunk {
    section: string;
    text: string;
    source: string;
}

const RULES_DIR = "bin/dnd-5e-rules";
const LMOP_DIR = "bin/lost-mines-of-phandelver";

function getRulesFilePaths(): string[] {
    const glob = new Glob("**/*");
    return Array.from(glob.scanSync(RULES_DIR)).map(f => `${RULES_DIR}/${f}`);
}

function getLmopFilePaths(): string[] {
    const glob = new Glob("**/*");
    return Array.from(glob.scanSync(LMOP_DIR)).map(f => `${LMOP_DIR}/${f}`);
}

function chunkMarkdownByHeaders(content: string, filePath: string): Chunk[] {
    const chunks: Chunk[] = [];
    const sections = content.split(/^(?=## )/m);

    for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;

        const headerMatch = trimmed.match(/^## (.+)/);
        const sectionName = headerMatch ? (headerMatch[1]?.trim() ?? "") : path.basename(filePath, path.extname(filePath));

        chunks.push({
            section: sectionName,
            text: trimmed,
            source: filePath,
        });
    }

    if (chunks.length === 0 && content.trim()) {
        chunks.push({
            section: path.basename(filePath, path.extname(filePath)),
            text: content.trim(),
            source: filePath,
        });
    }

    return chunks;
}

async function processRulesTable(records: RulesRecord[]): Promise<void> {
    const db = await lancedb.connect("./.kb_data");
    const tableName = "dnd_5e_rules";
    await db.openTable(tableName).catch(async () => {
        return await db.createTable(tableName, records);
    });
}

async function processLmopTable(records: RulesRecord[]): Promise<void> {
    const db = await lancedb.connect("./.kb_data");
    const tableName = "lost_mines_of_phandelver";
    await db.openTable(tableName).catch(async () => {
        return await db.createTable(tableName, records);
    });
}

async function processRules(): Promise<void> {
    const filePaths = getRulesFilePaths();
    console.log(`Found ${filePaths.length} files in ${RULES_DIR}`);

    // Read and chunk all files
    const allChunks: Chunk[] = [];
    for (const rfp of filePaths) {
        const content = await Bun.file(rfp).text();
        const chunks = chunkMarkdownByHeaders(content, rfp);
        allChunks.push(...chunks);
    }

    // Deduplicate by section name
    const seen = new Set<string>();
    const uniqueChunks = allChunks.filter(chunk => {
        if (seen.has(chunk.section)) return false;
        seen.add(chunk.section);
        return true;
    });

    console.log(`${allChunks.length} total chunks, ${uniqueChunks.length} unique after dedup`);

    // Embed each chunk with progress and error handling
    const records: RulesRecord[] = [];
    let failures = 0;

    for (let i = 0; i < uniqueChunks.length; i++) {
        const chunk = uniqueChunks[i];
        if (!chunk) {
            console.log(`Chunck ${i + 1} was null and was not processed`);
            continue;
        }

        console.log(`Processing ${i + 1}/${uniqueChunks.length}: "${chunk.section}" from ${chunk.source}`);

        try {
            const vector = await getEmbedding(chunk.text);
            records.push({
                id: i,
                text: chunk.text,
                vector,
                source: chunk.source,
                section: chunk.section,
            });
        } catch (err) {
            failures++;
            console.error(`  Failed to embed "${chunk.section}": ${err}`);
        }
    }

    console.log(`\n--- Summary ---`);
    console.log(`Files: ${filePaths.length}`);
    console.log(`Chunks: ${allChunks.length} total, ${uniqueChunks.length} unique`);
    console.log(`Embedded: ${records.length} success, ${failures} failures`);

    await processRulesTable(records);
    console.log(`Stored ${records.length} records in LanceDB`);
}

async function executeProcess(): Promise<void> {
    await processRules();
}

const db = await lancedb.connect("./.kb_data");
await db.dropAllTables();
await executeProcess();