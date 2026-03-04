const { chunkText: baseChunkText } = require('../ai/tools/agentRagService');

function chunkText(text, chunkSize = 1200, overlap = 200) {
  return baseChunkText(text, chunkSize, overlap);
}

module.exports = {
  chunkText,
};

