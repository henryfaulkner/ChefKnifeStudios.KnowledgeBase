import { queryKnowledgeBase, getTableNames } from "./query";

const query = process.argv.slice(2).join(" ");

if (!query) {
    console.error("Usage: bun run src/prompt.ts <your question>");
    process.exit(1);
}

const tableNames = await getTableNames();
const result = await queryKnowledgeBase(query);

console.log(`\n--- Sources (${result.sources.length} results from ${tableNames.length} tables) ---`);
for (const s of result.sources) {
    console.log(`  ${s.table} > ${s.section} (distance: ${s.distance.toFixed(4)})`);
}

console.log("\n--- AI RESPONSE ---\n", result.answer);
