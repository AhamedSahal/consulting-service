const pool = require('../../config/db');
const { getOpenAI } = require('./openaiService');

const EMBED_BATCH_SIZE = 100;

async function embedTexts(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const openai = getOpenAI();
  const input = texts.map((t) => t || '');
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input,
  });
  return res.data.map((d) => d.embedding);
}

async function embedTextsBatched(texts, batchSize = EMBED_BATCH_SIZE) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const all = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await embedTexts(batch);
    all.push(...embeddings);
  }
  return all;
}

async function vectorSearch({ ownerType, ownerId, query, topK = 20, docTypes }) {
  const trimmed = (query || '').trim();
  if (!ownerType || !trimmed) return [];

  const embeddingArr = await embedTexts([trimmed]);
  const [embedding] = embeddingArr || [];
  if (!embedding) return [];

  const client = await pool.connect();
  try {
    const filters = ['owner_type = $1'];
    const params = [ownerType];
    let idx = params.length;

    if (ownerId != null) {
      idx += 1;
      filters.push(`owner_id = $${idx}`);
      params.push(ownerId);
    }
    if (docTypes && docTypes.length > 0) {
      idx += 1;
      filters.push(`doc_type = ANY($${idx})`);
      params.push(docTypes);
    }

    idx += 1;
    params.push(JSON.stringify(embedding));
    const embedParamIndex = idx;

    idx += 1;
    params.push(topK);
    const limitIndex = idx;

    const sql = `
      SELECT id, owner_type, owner_id, document_id, doc_type, chunk_index, chunk_text, created_at
      FROM embeddings
      WHERE ${filters.join(' AND ')}
      ORDER BY embedding <-> $${embedParamIndex}::vector
      LIMIT $${limitIndex}
    `;

    const result = await client.query(sql, params);
    return result.rows || [];
  } finally {
    client.release();
  }
}

async function indexAgentPlaybookChunks({
  agentId,
  playbookId,
  title,
  chunks,
  embeddings,
  mimeType,
}) {
  if (!agentId || !playbookId || !Array.isArray(chunks) || chunks.length === 0) return;
  if (!Array.isArray(embeddings) || embeddings.length !== chunks.length) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM embeddings
       WHERE owner_type = 'JD_AGENT'
         AND owner_id = $1
         AND document_id = $2
         AND doc_type = 'PLAYBOOK'`,
      [agentId, playbookId],
    );

    const values = [];
    const placeholders = [];

    chunks.forEach((chunk, idx) => {
      const embedding = embeddings[idx];
      if (!embedding) return;

      const meta = {
        title: title || '',
        mime_type: mimeType || '',
        source: 'playbook',
      };

      // 8 values: owner_type, owner_id, document_id, doc_type,
      //           chunk_index, chunk_text, embedding, metadata
      values.push(
        'JD_AGENT',
        agentId,
        playbookId,
        'PLAYBOOK',
        idx,
        chunk,
        JSON.stringify(embedding),
        JSON.stringify(meta),
      );

      const base = values.length - 7; // first of the 8 params we just pushed
      placeholders.push(
        `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::vector, $${base + 7}::jsonb)`,
      );
    });

    if (placeholders.length > 0) {
      await client.query(
        `INSERT INTO embeddings
           (owner_type, owner_id, document_id, doc_type, chunk_index, chunk_text, embedding, metadata)
         VALUES ${placeholders.join(', ')}`,
        values,
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  embedTexts,
  embedTextsBatched,
  vectorSearch,
  indexAgentPlaybookChunks,
};
