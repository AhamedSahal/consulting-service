const OpenAI = require('openai');

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set. Add it to your .env file to use JD generation.');
  }
  return new OpenAI({ apiKey });
}

async function chatWithOpenAI(messages, options = {}) {
  const openai = getOpenAI();
  const {
    model = 'gpt-4o-mini',
    temperature = 0.7,
  } = options;

  const completion = await openai.chat.completions.create({
    model,
    messages,
    temperature,
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }
  return content;
}

async function streamChatWithOpenAI(messages, options = {}) {
  const openai = getOpenAI();
  const {
    model = 'gpt-4o-mini',
    temperature = 0.7,
  } = options;

  const stream = await openai.chat.completions.create({
    model,
    messages,
    temperature,
    stream: true,
  });

  return stream;
}

async function generateJobDescription(inputs) {
  const openai = getOpenAI();
  const { job_title, reports_to, job_family, level, role_summary, template_type, include_percentages } = inputs;

  const templateDesc = template_type === 'BSC' 
    ? 'Balanced Scorecard (BSC) format: organize responsibilities into buckets such as Financial, Customer, Internal Processes, Learning & Growth.'
    : 'Standard format: organize responsibilities by functional area or typical JD structure.';

  const prompt = `You are an expert HR consultant. Generate a professional, consulting-grade job description.

Inputs:
- Job Title: ${job_title}
- Reports To: ${reports_to}
- Job Family: ${job_family}
- Level: ${level}
- Role Summary: ${role_summary}
- Template Type: ${template_type}
- Include % Contribution: ${include_percentages ? 'Yes' : 'No'}

Requirements:
- Follow ${templateDesc}
- Create 5-8 responsibilities, each as a complete sentence starting with a strong action verb.
- Create 3-5 KPIs that are measurable and relevant.
- Create 3-5 technical competencies and 3-5 behavioral competencies.
- Output valid JSON only, no markdown or extra text.

Output format:
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
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  // Parse JSON (handle potential markdown code block)
  let jsonStr = content;
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    jsonStr = match[1].trim();
  }
  return JSON.parse(jsonStr);
}

module.exports = { generateJobDescription, chatWithOpenAI, streamChatWithOpenAI, getOpenAI };
