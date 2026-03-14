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

interface KBRecord {
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

interface DataSource {
    dir: string;
    tableName: string;
}

const DATA_SOURCES: DataSource[] = [
    { dir: "bin/dnd-5e-rules", tableName: "dnd_5e_rules" },
    { dir: "bin/lost-mines-of-phandelver", tableName: "lost_mines_of_phandelver" },
];

function getFilePaths(dir: string): string[] {
    const glob = new Glob("**/*");
    return Array.from(glob.scanSync(dir)).map(f => `${dir}/${f}`);
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

async function processDataSource(db: lancedb.Connection, source: DataSource): Promise<void> {
    const filePaths = getFilePaths(source.dir);
    if (filePaths.length === 0) {
        console.log(`Skipping "${source.tableName}" — no files found in ${source.dir}`);
        return;
    }

    console.log(`\n=== ${source.tableName} ===`);
    console.log(`Found ${filePaths.length} files in ${source.dir}`);

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
    const records: KBRecord[] = [];
    let failures = 0;

    for (let i = 0; i < uniqueChunks.length; i++) {
        const chunk = uniqueChunks[i];
        if (!chunk) {
            console.log(`Chunk ${i + 1} was null and was not processed`);
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

    console.log(`\n--- ${source.tableName} Summary ---`);
    console.log(`Files: ${filePaths.length}`);
    console.log(`Chunks: ${allChunks.length} total, ${uniqueChunks.length} unique`);
    console.log(`Embedded: ${records.length} success, ${failures} failures`);

    if (records.length > 0) {
        await db.openTable(source.tableName).catch(async () => {
            return await db.createTable(source.tableName, records);
        });
        console.log(`Stored ${records.length} records in table "${source.tableName}"`);
    }
}

const db = await lancedb.connect("./.kb_data");
await db.dropAllTables();

for (const source of DATA_SOURCES) {
    await processDataSource(db, source);
}

console.log("\nDone!");
