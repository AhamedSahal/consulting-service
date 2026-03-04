// Central registry for MCP tools used by the consulting agent service.
// Extend this registry as you add more tools.

const { vector_search } = require('./vectorSearchTool');
const { list_roles, get_company_context, get_org_structure } = require('./companyTools');
const {
  search_playbook_chunks,
  search_company_chunks,
  save_jd,
  export_jd,
} = require('./jdTools');

module.exports = {
  vector_search,
  list_roles,
  get_company_context,
  get_org_structure,
  search_playbook_chunks,
  search_company_chunks,
  save_jd,
  export_jd,
};


