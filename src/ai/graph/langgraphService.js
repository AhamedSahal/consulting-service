const { StateGraph, START, END } = require('@langchain/langgraph');
const { getOpenAI } = require('../tools/openaiService');
const { enforceVerbRules } = require('../tools/jdGeneratorService');
const { vector_search } = require('../../mcp/vectorSearchTool');
const {
  search_playbook_chunks,
  search_company_chunks,
  save_jd,
} = require('../../mcp/jdTools');

function buildRagQueryFromDraft(draft) {
  const parts = [];
  if (draft.job_title) parts.push(`Job Title: ${draft.job_title}`);
  if (draft.reports_to) parts.push(`Reports To: ${draft.reports_to}`);
  if (draft.job_family) parts.push(`Job Family: ${draft.job_family}`);
  if (draft.level) parts.push(`Level: ${draft.level}`);
  if (draft.role_summary) parts.push(`Role Summary: ${draft.role_summary}`);
  if (draft.raw_responsibilities) {
    parts.push(`Starter responsibilities: ${draft.raw_responsibilities}`);
  }
  return parts.join('\n');
}

function buildMcpToolHint(moduleKey) {
  if (!moduleKey) return '';
  const key = String(moduleKey).toUpperCase();
  if (key === 'JD_AGENT') {
    return 'You may call tools related to roles, organisation structures, and existing JDs when available.';
  }
  return 'Use available tools when they can improve factual accuracy.';
}

async function callJdLlm({ draft, moduleKey, ragChunks, strictPlaybook }) {
  const openai = getOpenAI();

  const playbookContext = (ragChunks || [])
    .map((c, idx) => `Chunk ${idx + 1}:\n${c.chunk_text}`)
    .join('\n\n---\n\n');

  const hasPlaybookContext = !!playbookContext.trim();
  const mcpHint = buildMcpToolHint(moduleKey);

  const guardrails = strictPlaybook
    ? [
        'You MUST treat the playbook context as hard constraints.',
        'Do NOT invent responsibilities or KPIs that materially contradict the playbook.',
        'If critical information is missing from the playbook, clearly state what is missing and avoid guessing.',
      ].join(' ')
    : [
        'Use the playbook context as a strong reference, but you may add reasonable details when needed.',
        'If context is missing, you may proceed with sensible placeholders (tag them clearly).',
      ].join(' ');

  const systemPrompt = [
    'You are an expert HR consultant using a LangGraph-style reasoning workflow.',
    'You generate structured, consulting-grade job descriptions as JSON only.',
    guardrails,
    mcpHint,
    hasPlaybookContext
      ? 'You have access to the following playbook context; base your JD primarily on this content.'
      : 'No playbook context is available. Work from the user inputs, and call out any assumptions.',
  ].join(' ');

  const userPromptLines = [
    'Generate a job description using the following inputs.',
    `Job Title: ${draft.job_title || ''}`,
    `Reports To: ${draft.reports_to || ''}`,
    `Job Family: ${draft.job_family || ''}`,
    `Level: ${draft.level || ''}`,
    `Role Summary: ${draft.role_summary || ''}`,
    `Template Type: ${draft.template_type || 'STANDARD'}`,
    `Include % Contribution: ${draft.include_percentages ? 'Yes' : 'No'}`,
  ];

  if (hasPlaybookContext) {
    userPromptLines.push('\nPlaybook Context:\n', playbookContext);
  }

  const templateDesc =
    draft.template_type === 'BSC'
      ? 'Balanced Scorecard (BSC) format: organise responsibilities into buckets such as Financial, Customer, Internal Processes, Learning & Growth.'
      : 'Standard format: organise responsibilities by functional area or typical JD structure.';

  const outputFormat = `
You must output valid JSON only, no markdown or extra text.

JSON schema:
{
  "job_title": "string",
  "reports_to": "string",
  "department": "string",
  "job_family": "string",
  "level": "string",
  "role_summary": "string",
  "responsibilities": {
    "bucketName1": ["item1", "item2"],
    "bucketName2": ["item1"]
  },
  "kpis": ["kpi1", "kpi2"],
  "competencies": {
    "technical": ["c1", "c2"],
    "behavioral": ["c1", "c2"]
  }
}

Follow ${templateDesc}.
`;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `${userPromptLines.join('\n')}\n\n${outputFormat}`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.4,
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty JD response from LLM');
  }

  let jsonStr = content;
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    jsonStr = match[1].trim();
  }

  return JSON.parse(jsonStr);
}

async function generateJdWithGraph({ draft, moduleKey, companyId, agentId, strictPlaybook }) {
  const ragQuery = buildRagQueryFromDraft(draft);

  const playbookChunks = await vector_search({
    ownerType: 'JD_AGENT',
    ownerId: agentId,
    query: ragQuery,
    topK: 20,
    docTypes: ['PLAYBOOK'],
  });

  const companyChunks = await vector_search({
    ownerType: 'COMPANY',
    ownerId: companyId,
    query: ragQuery,
    topK: 20,
    docTypes: ['COMPANY_DOC'],
  });

  const ragChunks = [...(playbookChunks || []), ...(companyChunks || [])];

  if (strictPlaybook && (!playbookChunks || playbookChunks.length === 0)) {
    return {
      error: 'NO_PLAYBOOK_CONTEXT',
      message:
        'Strict playbook mode is enabled but no playbook content was found for this module. Upload a playbook or disable strict mode.',
      ragChunks: [],
    };
  }

  let jdJson = await callJdLlm({ draft, moduleKey, ragChunks, strictPlaybook });
  jdJson = enforceVerbRules(jdJson, draft.level);

  return {
    jdJson,
    ragChunks,
  };
}

function jdJsonToMarkdown(jdJson) {
  if (!jdJson) return '';

  const lines = [];
  if (jdJson.job_title) {
    lines.push(`# ${jdJson.job_title}`);
  }
  if (jdJson.department || jdJson.job_family || jdJson.level || jdJson.reports_to) {
    lines.push('');
    if (jdJson.department) lines.push(`**Department:** ${jdJson.department}`);
    if (jdJson.job_family) lines.push(`**Job Family:** ${jdJson.job_family}`);
    if (jdJson.level) lines.push(`**Level:** ${jdJson.level}`);
    if (jdJson.reports_to) lines.push(`**Reports To:** ${jdJson.reports_to}`);
  }
  if (jdJson.role_summary) {
    lines.push('');
    lines.push('## Role Summary');
    lines.push('');
    lines.push(jdJson.role_summary);
  }
  if (jdJson.responsibilities && typeof jdJson.responsibilities === 'object') {
    lines.push('');
    lines.push('## Key Responsibilities');
    Object.entries(jdJson.responsibilities).forEach(([bucket, items]) => {
      lines.push('');
      lines.push(`### ${bucket}`);
      (items || []).forEach((item) => {
        lines.push(`- ${item}`);
      });
    });
  }
  if (Array.isArray(jdJson.kpis) && jdJson.kpis.length) {
    lines.push('');
    lines.push('## Key Performance Indicators (KPIs)');
    lines.push('');
    jdJson.kpis.forEach((kpi) => {
      lines.push(`- ${kpi}`);
    });
  }
  if (jdJson.competencies && typeof jdJson.competencies === 'object') {
    const { technical, behavioral } = jdJson.competencies;
    if ((technical && technical.length) || (behavioral && behavioral.length)) {
      lines.push('');
      lines.push('## Competencies');
      if (technical && technical.length) {
        lines.push('');
        lines.push('### Technical');
        technical.forEach((c) => lines.push(`- ${c}`));
      }
      if (behavioral && behavioral.length) {
        lines.push('');
        lines.push('### Behavioral');
        behavioral.forEach((c) => lines.push(`- ${c}`));
      }
    }
  }
  return lines.join('\n');
}

let strictJdGraph;

function getStrictJdGraph() {
  if (strictJdGraph) return strictJdGraph;

  const graph = new StateGraph({
    channels: {
      prompt: { default: '' },
      companyId: { default: null },
      playbookId: { default: null },
      agentId: { default: null },
      title: { default: '' },
      query: { default: '' },
      playbookChunks: { default: [] },
      companyChunks: { default: [] },
      jdJson: { default: null },
      jdMarkdown: { default: '' },
      sources: { default: [] },
      jdRecord: { default: null },
    },
  });

  graph.addNode('validateInput', async (state) => {
    const prompt = (state.prompt || '').trim();
    const companyId = state.companyId;
    const playbookId = state.playbookId;
    const agentId = state.agentId;

    if (!prompt) {
      throw new Error('Prompt is required for strict JD generation');
    }
    if (!companyId || !playbookId) {
      throw new Error('Both companyId and playbookId are required for strict JD generation');
    }
    if (!agentId) {
      throw new Error('agentId is required for strict JD generation');
    }

    let title = (state.title || '').trim();
    if (!title) {
      const match = prompt.match(/for\s+(.+)$/i);
      title = match ? match[1].trim() : prompt;
    }

    return {
      ...state,
      prompt,
      companyId,
      playbookId,
      agentId,
      title,
    };
  });

  graph.addNode('planQueries', async (state) => {
    const query = state.prompt || '';
    return {
      ...state,
      query,
      limits: {
        playbookTopK: 10,
        companyTopK: 20,
      },
    };
  });

  graph.addNode('retrievePlaybookChunks', async (state) => {
    const chunks = await search_playbook_chunks({
      agentId: state.agentId,
      playbookId: state.playbookId,
      query: state.query,
      topK: (state.limits && state.limits.playbookTopK) || 10,
    });
    return {
      ...state,
      playbookChunks: chunks || [],
    };
  });

  graph.addNode('retrieveCompanyChunks', async (state) => {
    const chunks = await search_company_chunks({
      companyId: state.companyId,
      query: state.query,
      topK: (state.limits && state.limits.companyTopK) || 20,
      docType: 'COMPANY_DOC',
    });
    return {
      ...state,
      companyChunks: chunks || [],
    };
  });

  graph.addNode('draftJD', async (state) => {
    const draft = {
      job_title: state.title,
      reports_to: '',
      job_family: '',
      level: '',
      role_summary: state.prompt,
      template_type: 'STANDARD',
      include_percentages: false,
      raw_responsibilities: null,
    };

    const ragChunks = [...(state.playbookChunks || []), ...(state.companyChunks || [])];

    if (!state.playbookChunks || state.playbookChunks.length === 0) {
      throw new Error(
        'Strict JD generation requires playbook content, but no playbook chunks were found.',
      );
    }

    let jdJson = await callJdLlm({
      draft,
      moduleKey: 'JD_AGENT',
      ragChunks,
      strictPlaybook: true,
    });
    jdJson = enforceVerbRules(jdJson, draft.level);

    return {
      ...state,
      jdJson,
      ragChunks,
    };
  });

  graph.addNode('qualityCheck', async (state) => {
    const jdJson = state.jdJson || {};
    const requiredKeys = ['job_title', 'role_summary', 'responsibilities', 'kpis', 'competencies'];
    const missing = requiredKeys.filter((k) => jdJson[k] == null);
    if (missing.length) {
      throw new Error(`JD JSON is missing required fields: ${missing.join(', ')}`);
    }
    if (typeof jdJson.responsibilities !== 'object') {
      throw new Error('JD JSON responsibilities must be an object of arrays');
    }
    if (!Array.isArray(jdJson.kpis)) {
      throw new Error('JD JSON kpis must be an array');
    }
    if (typeof jdJson.competencies !== 'object') {
      throw new Error('JD JSON competencies must be an object');
    }
    return state;
  });

  graph.addNode('persistJD', async (state) => {
    const jdMarkdown = jdJsonToMarkdown(state.jdJson);

    const playbookSources = (state.playbookChunks || []).map((c) => ({
      type: 'PLAYBOOK',
      id: c.id,
      documentId: c.document_id,
      chunkIndex: c.chunk_index,
      snippet: (c.chunk_text || '').slice(0, 300),
    }));
    const companySources = (state.companyChunks || []).map((c) => ({
      type: 'COMPANY',
      id: c.id,
      documentId: c.document_id,
      chunkIndex: c.chunk_index,
      snippet: (c.chunk_text || '').slice(0, 300),
    }));
    const sources = [...playbookSources, ...companySources];

    const jdRecord = await save_jd({
      companyId: state.companyId,
      playbookId: state.playbookId,
      title: state.title,
      prompt: state.prompt,
      jdJson: state.jdJson,
      jdMarkdown,
      sources,
    });

    return {
      ...state,
      jdMarkdown,
      sources,
      jdRecord,
    };
  });

  graph.addNode('returnResult', async (state) => ({
    jdId: state.jdRecord && state.jdRecord.id,
    jdJson: state.jdJson,
    jdMarkdown: state.jdMarkdown,
    sources: state.sources || [],
  }));

  // Entry edge from the implicit START node into the workflow
  graph.addEdge(START, 'validateInput');

  graph.addEdge('validateInput', 'planQueries');
  graph.addEdge('planQueries', 'retrievePlaybookChunks');
  graph.addEdge('retrievePlaybookChunks', 'retrieveCompanyChunks');
  graph.addEdge('retrieveCompanyChunks', 'draftJD');
  graph.addEdge('draftJD', 'qualityCheck');
  graph.addEdge('qualityCheck', 'persistJD');
  graph.addEdge('persistJD', 'returnResult');
  graph.addEdge('returnResult', END);

  strictJdGraph = graph.compile();
  return strictJdGraph;
}

async function runStrictJdGraph({ prompt, companyId, playbookId, agentId, title }) {
  const graph = getStrictJdGraph();
  const result = await graph.invoke({
    prompt,
    companyId,
    playbookId,
    agentId,
    title: title || '',
  });
  return result;
}

module.exports = {
  generateJdWithGraph,
  runStrictJdGraph,
};

