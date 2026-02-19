// Verb rules by level
const VERB_RULES = {
  'Assistant Manager': ['Manage', 'Be responsible for', 'Implement', 'Execute', 'Plan', 'Monitor', 'Ensure', 'Assist', 'Oversee'],
  'Team Lead': ['Manage', 'Be responsible for', 'Implement', 'Execute', 'Plan', 'Monitor', 'Ensure', 'Assist', 'Oversee'],
  'Specialist': ['Prepare', 'Report', 'Ensure', 'Execute', 'Assist', 'Coordinate', 'Compile', 'Organise', 'Contribute'],
  'Analyst': ['Prepare', 'Report', 'Ensure', 'Execute', 'Assist', 'Coordinate', 'Compile', 'Organise', 'Contribute'],
  'Executive': ['Prepare', 'Report', 'Ensure', 'Execute', 'Assist', 'Coordinate', 'Compile', 'Organise', 'Contribute'],
  'Manager': ['Strategize', 'Define', 'Create', 'Design', 'Formulate', 'Overlook', 'Plan', 'Identify', 'Develop', 'Evaluate', 'Lead', 'Establish'],
  'Senior Manager': ['Strategize', 'Define', 'Create', 'Design', 'Formulate', 'Overlook', 'Plan', 'Identify', 'Develop', 'Evaluate', 'Lead', 'Establish'],
  'Director': ['Strategize', 'Define', 'Create', 'Design', 'Formulate', 'Overlook', 'Plan', 'Identify', 'Develop', 'Evaluate', 'Lead', 'Establish']
};

function getAllowedVerbs(level) {
  if (!level) return null;
  const normalized = level.trim();
  for (const [key, verbs] of Object.entries(VERB_RULES)) {
    if (normalized.toLowerCase().includes(key.toLowerCase())) {
      return verbs;
    }
  }
  return null;
}

function rewriteToStartWithVerb(sentence, allowedVerbs) {
  if (!sentence || typeof sentence !== 'string') return sentence;
  const trimmed = sentence.trim();
  if (!trimmed) return sentence;

  const firstWord = trimmed.split(/\s+/)[0];
  const firstWordBase = firstWord.replace(/[^\w]/g, '');
  const startsWithAllowed = allowedVerbs.some(
    (v) => firstWordBase.toLowerCase().startsWith(v.toLowerCase()) || firstWord.toLowerCase() === v.toLowerCase()
  );
  if (startsWithAllowed) return sentence;

  // Rewrite: add a prefix verb if it makes sense
  const lower = trimmed.toLowerCase();
  let newStart = null;
  if (lower.includes('manage') || lower.includes('lead') || lower.includes('oversee')) {
    newStart = 'Manage';
  } else if (lower.includes('develop') || lower.includes('create') || lower.includes('design')) {
    newStart = 'Develop';
  } else if (lower.includes('coordinate') || lower.includes('support') || lower.includes('assist')) {
    newStart = 'Coordinate';
  } else if (lower.includes('ensure') || lower.includes('maintain')) {
    newStart = 'Ensure';
  } else if (lower.includes('prepare') || lower.includes('compile')) {
    newStart = 'Prepare';
  } else if (lower.includes('plan') || lower.includes('implement')) {
    newStart = 'Plan';
  } else if (lower.includes('execute') || lower.includes('carry out')) {
    newStart = 'Execute';
  } else if (lower.includes('report') || lower.includes('monitor')) {
    newStart = 'Report';
  } else if (lower.includes('organise') || lower.includes('organize')) {
    newStart = 'Organise';
  } else if (lower.includes('contribute') || lower.includes('participate')) {
    newStart = 'Contribute';
  } else {
    newStart = allowedVerbs[0] || 'Manage';
  }

  // If sentence doesn't start with article (The, A, An), we might need to restructure
  const articles = ['the', 'a', 'an'];
  const words = trimmed.split(/\s+/);
  if (articles.includes(words[0].toLowerCase())) {
    return `${newStart} ${trimmed}`;
  }
  return `${newStart} ${trimmed.charAt(0).toLowerCase() + trimmed.slice(1)}`;
}

function enforceVerbRules(jdJson, level) {
  if (!jdJson || !level) return jdJson;
  const allowedVerbs = getAllowedVerbs(level);
  if (!allowedVerbs) return jdJson;

  const result = JSON.parse(JSON.stringify(jdJson));
  if (result.responsibilities && typeof result.responsibilities === 'object') {
    for (const bucket of Object.keys(result.responsibilities)) {
      result.responsibilities[bucket] = (result.responsibilities[bucket] || []).map((item) =>
        rewriteToStartWithVerb(item, allowedVerbs)
      );
    }
  }
  return result;
}

module.exports = { enforceVerbRules, getAllowedVerbs };
