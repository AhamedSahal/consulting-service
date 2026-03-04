const jobs = [];

let processing = false;

function enqueueJob(name, fn) {
  const id = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  jobs.push({ id, name, fn });
  if (!processing) {
    setImmediate(processQueue);
  }
  return id;
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (jobs.length > 0) {
    const job = jobs.shift();
    try {
      // eslint-disable-next-line no-await-in-loop
      await job.fn();
    } catch (err) {
      // Best-effort background worker – log and continue
      console.error(`Background job "${job.name}" failed:`, err);
    }
  }
  processing = false;
}

module.exports = {
  enqueueJob,
};

