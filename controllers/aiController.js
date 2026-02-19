const { chatWithOpenAI, streamChatWithOpenAI } = require('../services/openaiService');

async function chat(req, res) {
  const { message, messages } = req.body || {};

  if (!message && (!Array.isArray(messages) || messages.length === 0)) {
    return res.status(400).json({ error: 'message or messages is required' });
  }

  // Build conversation history
  const history = (Array.isArray(messages) && messages.length > 0
    ? messages
    : [{ role: 'user', content: message }]
  ).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || ''),
  }));

  // Add a system prompt to steer behaviour for HR consulting
  const systemPrompt = [
    'You are an AI co-pilot for HR consulting and workforce strategy.',
    'You speak clearly and practically, like a senior HR advisor.',
    'Always answer in a structured, point-wise way that is easy to scan.',
    'Always format your answer using Markdown, never HTML.',
    'Use "##" for the main title and "###" for section headings where relevant.',
    'Use bullet points ("- ") for lists, with a blank line between sections so they render cleanly in chat.',
    'Prefer concise paragraphs over long walls of text.',
    'When relevant, relate answers to job design, organisation structure, KPIs, workforce costs, and HR transformation initiatives.',
  ].join(' ');

  const messagesForOpenAI = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  try {
    const reply = await chatWithOpenAI(messagesForOpenAI, { temperature: 0.6 });
    return res.json({ reply });
  } catch (err) {
    console.error('AI chat error:', err);
    return res
      .status(500)
      .json({ error: err.message || 'AI chat failed' });
  }
}

async function chatStream(req, res) {
  const { message, messages } = req.body || {};

  if (!message && (!Array.isArray(messages) || messages.length === 0)) {
    return res.status(400).json({ error: 'message or messages is required' });
  }

  const history = (Array.isArray(messages) && messages.length > 0
    ? messages
    : [{ role: 'user', content: message }]
  ).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || ''),
  }));

  const systemPrompt = [
    'You are an AI co-pilot for HR consulting and workforce strategy.',
    'You speak clearly and practically, like a senior HR advisor.',
    'Always answer in a structured, point-wise way that is easy to scan.',
    'Always format your answer using Markdown, never HTML.',
    'Use "##" for the main title and "###" for section headings where relevant.',
    'Use bullet points ("- ") for lists, with a blank line between sections so they render cleanly in chat.',
    'Prefer concise paragraphs over long walls of text.',
    'When relevant, relate answers to job design, organisation structure, KPIs, workforce costs, and HR transformation initiatives.',
  ].join(' ');

  const messagesForOpenAI = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const stream = await streamChatWithOpenAI(messagesForOpenAI, { temperature: 0.6 });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) {
        res.write(delta);
      }
    }
    res.end();
  } catch (err) {
    console.error('AI chat stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'AI chat stream failed' });
    } else {
      res.end();
    }
  }
}

module.exports = { chat, chatStream };

