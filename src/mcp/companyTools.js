const { searchCompanyContext } = require('../ai/tools/companyEmbeddingService');

async function list_roles(args) {
  const { companyId } = args || {};
  // Stub implementation – later, parse OLD_JD documents to extract roles.
  if (!companyId) {
    throw new Error('companyId is required');
  }
  return {
    companyId,
    roles: [],
    status: 'not_implemented',
  };
}

async function get_company_context(args) {
  const { companyId, query, limit = 10 } = args || {};
  if (!companyId || !query) {
    throw new Error('companyId and query are required');
  }
  const chunks = await searchCompanyContext(companyId, query, limit);
  return {
    companyId,
    query,
    chunks,
  };
}

async function get_org_structure(args) {
  const { companyId } = args || {};
  if (!companyId) {
    throw new Error('companyId is required');
  }
  // Stub – future: derive from company documents or dedicated tables.
  return {
    companyId,
    status: 'not_implemented',
    orgStructure: null,
  };
}

module.exports = {
  list_roles,
  get_company_context,
  get_org_structure,
};

