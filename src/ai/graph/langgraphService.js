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
    `Department: ${draft.department || ''}`,
    `Location: ${draft.location || ''}`,
    `Grade: ${draft.grade || ''}`,
    `No. of Direct Reports: ${draft.no_of_direct_reports || ''}`,
    `Job Family: ${draft.job_family || ''}`,
    `Level: ${draft.level || ''}`,
    `Role Summary / Job Purpose: ${draft.role_summary || ''}`,
  ];

  if (hasPlaybookContext) {
    userPromptLines.push('\nPlaybook Context:\n', playbookContext);
  }

  const outputFormat = `
You must output valid JSON only, no markdown or extra text.

JSON schema:
{
  "job_information": {
    "job_title": "string",
    "reports_to": "string",
    "department": "string",
    "location": "string",
    "grade": "string",
    "no_of_direct_reports": "string"
  },
  "job_purpose": "A clear paragraph describing the overarching purpose and strategic importance of the role",
  "key_accountabilities": [
    "Action-oriented accountability statement 1",
    "Action-oriented accountability statement 2"
  ],
  "financial_dimensions": "Description of budget, revenue, or cost responsibilities (e.g. 'Manages an operating budget of ...'). Use N/A if not applicable.",
  "key_communications": {
    "internal": ["Internal stakeholder or team 1", "Internal stakeholder or team 2"],
    "external": ["External party 1", "External party 2"]
  },
  "minimum_qualifications": [
    "Educational qualification or certification required",
    "Years of experience required",
    "Other mandatory experience"
  ],
  "technical_skills": [
    "Technical skill or tool proficiency 1",
    "Technical skill or tool proficiency 2"
  ],
  "competencies": [
    "Competency 1",
    "Competency 2"
  ],
  "special_requirements": "Any special requirements such as travel, shift work, physical demands, or mandatory certifications. Use N/A if none.",
  "approvals": {
    "prepared_by": "",
    "approved_by": "",
    "date": ""
  }
}
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
  lines.push('# JOB DESCRIPTION');

  // 1. JOB INFORMATION
  lines.push('');
  lines.push('## 1. JOB INFORMATION');
  lines.push('');
  const info = jdJson.job_information || {};
  lines.push(`**Job Title:** ${info.job_title || jdJson.job_title || ''}`);
  lines.push(`**Reports To:** ${info.reports_to || jdJson.reports_to || ''}`);
  lines.push(`**Department:** ${info.department || jdJson.department || ''}`);
  lines.push(`**Location:** ${info.location || ''}`);
  lines.push(`**Grade:** ${info.grade || ''}`);
  lines.push(`**No. of Direct Reports:** ${info.no_of_direct_reports || ''}`);

  // 2. JOB PURPOSE
  lines.push('');
  lines.push('## 2. JOB PURPOSE');
  lines.push('');
  lines.push(jdJson.job_purpose || jdJson.role_summary || '');

  // 3. KEY ACCOUNTABILITIES & RESPONSIBILITIES
  lines.push('');
  lines.push('## 3. KEY ACCOUNTABILITIES & RESPONSIBILITIES');
  lines.push('');
  const accountabilities = jdJson.key_accountabilities || [];
  if (Array.isArray(accountabilities) && accountabilities.length) {
    accountabilities.forEach((item) => lines.push(`- ${item}`));
  }

  // 4. FINANCIAL DIMENSIONS
  lines.push('');
  lines.push('## 4. FINANCIAL DIMENSIONS');
  lines.push('');
  lines.push(jdJson.financial_dimensions || '');

  // 5. KEY COMMUNICATIONS
  lines.push('');
  lines.push('## 5. KEY COMMUNICATIONS');
  const comms = jdJson.key_communications || {};
  if (Array.isArray(comms.internal) && comms.internal.length) {
    lines.push('');
    lines.push('**Internal:**');
    comms.internal.forEach((c) => lines.push(`- ${c}`));
  }
  if (Array.isArray(comms.external) && comms.external.length) {
    lines.push('');
    lines.push('**External:**');
    comms.external.forEach((c) => lines.push(`- ${c}`));
  }

  // 6. MINIMUM QUALIFICATION / EXPERIENCE / TRAINING
  lines.push('');
  lines.push('## 6. MINIMUM QUALIFICATION / EXPERIENCE / TRAINING');
  lines.push('');
  const quals = jdJson.minimum_qualifications || [];
  if (Array.isArray(quals) && quals.length) {
    quals.forEach((q) => lines.push(`- ${q}`));
  }

  // 7. TECHNICAL SKILLS / KNOWLEDGE
  lines.push('');
  lines.push('## 7. TECHNICAL SKILLS / KNOWLEDGE');
  lines.push('');
  const skills = jdJson.technical_skills || [];
  if (Array.isArray(skills) && skills.length) {
    skills.forEach((s) => lines.push(`- ${s}`));
  }

  // 8. COMPETENCIES
  lines.push('');
  lines.push('## 8. COMPETENCIES');
  lines.push('');
  const comps = jdJson.competencies || [];
  if (Array.isArray(comps) && comps.length) {
    comps.forEach((c) => lines.push(`- ${c}`));
  }

  // 9. SPECIAL JOB REQUIREMENTS
  lines.push('');
  lines.push('## 9. SPECIAL JOB REQUIREMENTS');
  lines.push('');
  lines.push(jdJson.special_requirements || '');

  // 10. APPROVALS
  lines.push('');
  lines.push('## 10. APPROVALS');
  lines.push('');
  const approvals = jdJson.approvals || {};
  lines.push(`**Prepared By:** ${approvals.prepared_by || ''}`);
  lines.push(`**Approved By:** ${approvals.approved_by || ''}`);
  lines.push(`**Date:** ${approvals.date || ''}`);

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
    const requiredKeys = [
      'job_information',
      'job_purpose',
      'key_accountabilities',
      'minimum_qualifications',
      'technical_skills',
      'competencies',
    ];
    const missing = requiredKeys.filter((k) => jdJson[k] == null);
    if (missing.length) {
      throw new Error(`JD JSON is missing required fields: ${missing.join(', ')}`);
    }
    if (!Array.isArray(jdJson.key_accountabilities)) {
      throw new Error('JD JSON key_accountabilities must be an array');
    }
    if (!Array.isArray(jdJson.minimum_qualifications)) {
      throw new Error('JD JSON minimum_qualifications must be an array');
    }
    if (!Array.isArray(jdJson.technical_skills)) {
      throw new Error('JD JSON technical_skills must be an array');
    }
    if (!Array.isArray(jdJson.competencies)) {
      throw new Error('JD JSON competencies must be an array');
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

