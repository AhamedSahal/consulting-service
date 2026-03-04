const { vectorSearch } = require('../ai/tools/vectorStoreService');

async function vector_search(args) {
  const {
    ownerType,
    ownerId = null,
    moduleKey = null,
    companyId = null,
    query,
    topK = 20,
    docTypes = null,
  } = args || {};

  if (!ownerType || !query) {
    throw new Error('ownerType and query are required for vector_search');
  }

  const rows = await vectorSearch({
    ownerType,
    ownerId: ownerId != null ? Number(ownerId) : null,
    moduleKey,
    companyId,
    query: query.trim(),
    topK,
    docTypes,
  });

  return rows;
}

module.exports = {
  vector_search,
};
