// Scaffold for a future LangGraph-based JD Agent that uses company context.
// This is intentionally minimal – the full graph will be implemented later.

async function runCompanyJdGraph({ companyId, request }) {
  return {
    status: 'not_implemented',
    companyId,
    request,
  };
}

module.exports = {
  runCompanyJdGraph,
};

