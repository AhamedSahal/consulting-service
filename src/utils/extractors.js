const { extractText, cleanText } = require('../ai/tools/agentRagService');

async function extractTextFromFile(filePath, mimeType) {
  const raw = await extractText(filePath, mimeType);
  return cleanText(raw);
}

module.exports = {
  extractTextFromFile,
};

