import { OLLAMA_URL, EMBEDDING_MODEL } from "./config";

export async function getEmbedding(text: string): Promise<number[]> {
    const res = await fetch(`${OLLAMA_URL}/embeddings`, {
        method: "POST",
        body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
    });

    if (!res.ok) {
        throw new Error(`Embedding request failed: ${res.status} ${res.statusText}`);
    }

    const json: any = await res.json();
    return json.embedding;
}
