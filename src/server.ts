import {
    queryKnowledgeBase,
    getTableNames,
    searchKnowledgeBase,
    buildContext,
    generateAnswerStream,
} from "./query";
import { SERVER_PORT } from "./config";

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status: number = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
}

function errorResponse(message: string, status: number): Response {
    return jsonResponse({ error: message }, status);
}

async function handleQuery(req: Request): Promise<Response> {
    const body: any = await req.json().catch(() => null);

    if (!body || typeof body.query !== "string" || !body.query.trim()) {
        return errorResponse("Request body must include a non-empty 'query' string", 400);
    }

    const limit = typeof body.limit === "number" ? body.limit : undefined;

    try {
        const result = await queryKnowledgeBase(body.query.trim(), limit);
        return jsonResponse(result);
    } catch (err: any) {
        console.error("Query error:", err);
        return errorResponse(`Query failed: ${err.message}`, 502);
    }
}

async function handleQueryStream(req: Request): Promise<Response> {
    const body: any = await req.json().catch(() => null);

    if (!body || typeof body.query !== "string" || !body.query.trim()) {
        return errorResponse("Request body must include a non-empty 'query' string", 400);
    }

    const limit = typeof body.limit === "number" ? body.limit : undefined;
    const query = body.query.trim();

    try {
        // Search phase (non-streaming)
        const results = await searchKnowledgeBase(query, limit);
        const context = buildContext(results);
        const sources = results.map((r) => ({
            table: r._table,
            section: r.section,
            source: r.source,
            distance: r._distance,
        }));

        // Get the streaming response from Ollama
        const ollamaRes = await generateAnswerStream(query, context);
        const ollamaBody = ollamaRes.body;
        if (!ollamaBody) {
            return errorResponse("No response body from LLM", 502);
        }

        // Create an SSE stream that first sends sources, then streams tokens
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                // Send sources as the first event
                controller.enqueue(
                    encoder.encode(`event: sources\ndata: ${JSON.stringify(sources)}\n\n`)
                );

                // Pipe Ollama's NDJSON stream as token events
                const reader = ollamaBody.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop() || "";

                        for (const line of lines) {
                            if (!line.trim()) continue;
                            try {
                                const json = JSON.parse(line);
                                if (json.response) {
                                    controller.enqueue(
                                        encoder.encode(`event: token\ndata: ${JSON.stringify(json.response)}\n\n`)
                                    );
                                }
                                if (json.done) {
                                    controller.enqueue(
                                        encoder.encode(`event: done\ndata: {}\n\n`)
                                    );
                                }
                            } catch {
                                // skip malformed lines
                            }
                        }
                    }
                } catch (err: any) {
                    controller.enqueue(
                        encoder.encode(`event: error\ndata: ${JSON.stringify(err.message)}\n\n`)
                    );
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                ...CORS_HEADERS,
            },
        });
    } catch (err: any) {
        console.error("Stream query error:", err);
        return errorResponse(`Query failed: ${err.message}`, 502);
    }
}

async function handleHealth(): Promise<Response> {
    try {
        const tables = await getTableNames();
        return jsonResponse({
            status: "ok",
            tables_available: tables.length,
            timestamp: new Date().toISOString(),
        });
    } catch (err: any) {
        return jsonResponse(
            { status: "degraded", error: err.message, timestamp: new Date().toISOString() },
            503
        );
    }
}

async function handleTables(): Promise<Response> {
    try {
        const tables = await getTableNames();
        return jsonResponse({ tables });
    } catch (err: any) {
        return errorResponse(`Failed to list tables: ${err.message}`, 500);
    }
}

const server = Bun.serve({
    port: SERVER_PORT,
    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const method = req.method;

        if (method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        if (method === "POST" && url.pathname === "/query") return handleQuery(req);
        if (method === "POST" && url.pathname === "/query/stream") return handleQueryStream(req);
        if (method === "GET" && url.pathname === "/health") return handleHealth();
        if (method === "GET" && url.pathname === "/tables") return handleTables();

        return errorResponse("Not Found", 404);
    },
});

console.log(`KB API server running at http://localhost:${server.port}`);
