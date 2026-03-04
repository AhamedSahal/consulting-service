const { streamChatWithOpenAI } = require('../../ai/tools/openaiService');
const { runStrictJdGraph } = require('../../ai/graph/langgraphService');

async function streamChat(req, res) {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

  if (!messages.length) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }

  try {
    const companyIdRaw = req.body && req.body.company_id;
    const playbookIdRaw = req.body && req.body.playbook_id;
    const agentIdRaw = req.body && req.body.agent_id;
    const authCompanyId = req.user && req.user.company_id;

    let companyId =
      typeof companyIdRaw === 'string' ? Number.parseInt(companyIdRaw, 10) : companyIdRaw;
    if (!Number.isFinite(companyId) || companyId <= 0) {
      companyId = authCompanyId || null;
    }
    const playbookId =
      typeof playbookIdRaw === 'string' ? Number.parseInt(playbookIdRaw, 10) : playbookIdRaw;
    const agentId =
      typeof agentIdRaw === 'string' ? Number.parseInt(agentIdRaw, 10) : agentIdRaw;

    const isStrictMode =
      Number.isFinite(playbookId) &&
      playbookId > 0 &&
      Number.isFinite(agentId) &&
      agentId > 0;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    if (isStrictMode) {
      const lastMessage = messages[messages.length - 1];
      const prompt = (lastMessage && lastMessage.content) || '';

      const result = await runStrictJdGraph({
        prompt,
        companyId,
        playbookId,
        agentId,
      });

      if (!result || !result.jdMarkdown) {
        throw new Error('Strict JD graph did not return markdown content');
      }

      if (result.jdId) {
        res.setHeader('X-JD-Id', String(result.jdId));
      }

      res.write(result.jdMarkdown);
      res.end();
      return;
    }

    const stream = await streamChatWithOpenAI(messages);

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        res.write(delta);
      }
    }

    res.end();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('AI chat stream error:', err);

    if (!res.headersSent) {
      res.status(500).json({
        error: err.message || 'AI chat failed',
      });
    } else {
      res.end();
    }
  }
}

module.exports = {
  streamChat,
};

