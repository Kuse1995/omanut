/**
 * Shared Gemini Embedding 2 client for semantic search.
 * Uses gemini-embedding-2-preview with adjustable output dimensionality.
 */

const EMBEDDING_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent';

export interface EmbeddingOptions {
  text: string;
  dimensions?: number;
  taskType?: string;
}

/**
 * Generate an embedding vector for the given text using Gemini Embedding 2.
 * Returns a float array of the specified dimensionality (default 768).
 */
export async function embedText(options: EmbeddingOptions): Promise<number[]> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const dimensions = options.dimensions || 768;

  const body: any = {
    content: {
      parts: [{ text: options.text }],
    },
    outputDimensionality: dimensions,
  };

  if (options.taskType) {
    body.taskType = options.taskType;
  }

  const response = await fetch(`${EMBEDDING_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Embedding API error (${response.status}):`, errText.substring(0, 300));
    throw new Error(`Embedding failed: ${response.status}`);
  }

  const data = await response.json();
  const values = data.embedding?.values;

  if (!values || !Array.isArray(values)) {
    throw new Error('No embedding values in response');
  }

  return values;
}

/**
 * Embed multiple texts in sequence (Gemini Embedding 2 doesn't have a batch endpoint yet).
 * Returns array of vectors in the same order as input texts.
 */
export async function embedBatch(texts: string[], dimensions?: number): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    const vec = await embedText({ text, dimensions, taskType: 'RETRIEVAL_DOCUMENT' });
    results.push(vec);
  }
  return results;
}

/**
 * Embed a query for search (uses RETRIEVAL_QUERY task type for better search results).
 */
export async function embedQuery(text: string, dimensions?: number): Promise<number[]> {
  return embedText({ text, dimensions: dimensions || 768, taskType: 'RETRIEVAL_QUERY' });
}
