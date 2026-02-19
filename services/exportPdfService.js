const PDFDocument = require('pdfkit');
const { Readable } = require('stream');

function buildPdfBuffer(jdJson) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const j = jdJson || {};
    const title = j.job_title || 'Job Description';
    doc.fontSize(18).text(title, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10);
    if (j.reports_to) doc.text(`Reports To: ${j.reports_to}`);
    if (j.level) doc.text(`Level: ${j.level}`);
    if (j.job_family || j.department) doc.text(`Department: ${j.job_family || j.department}`);
    doc.moveDown(1);

    if (j.role_summary) {
      doc.fontSize(12).text('Role Summary', { underline: true });
      doc.fontSize(10).text(j.role_summary, { align: 'justify' });
      doc.moveDown(1);
    }

    if (j.responsibilities && typeof j.responsibilities === 'object') {
      doc.fontSize(12).text('Responsibilities', { underline: true });
      doc.moveDown(0.5);
      for (const [bucket, items] of Object.entries(j.responsibilities)) {
        doc.fontSize(11).text(bucket || 'General');
        (items || []).forEach((item) => {
          doc.fontSize(10).text(`• ${item}`, { indent: 20 });
        });
        doc.moveDown(0.5);
      }
      doc.moveDown(0.5);
    }

    if (j.kpis && j.kpis.length) {
      doc.fontSize(12).text('Key Performance Indicators', { underline: true });
      doc.moveDown(0.5);
      j.kpis.forEach((k) => doc.fontSize(10).text(`• ${k}`, { indent: 20 }));
      doc.moveDown(1);
    }

    if (j.competencies && (j.competencies.technical?.length || j.competencies.behavioral?.length)) {
      doc.fontSize(12).text('Competencies', { underline: true });
      doc.moveDown(0.5);
      if (j.competencies.technical?.length) {
        doc.fontSize(11).text('Technical');
        j.competencies.technical.forEach((c) => doc.fontSize(10).text(`• ${c}`, { indent: 20 }));
      }
      if (j.competencies.behavioral?.length) {
        doc.fontSize(11).text('Behavioral');
        j.competencies.behavioral.forEach((c) => doc.fontSize(10).text(`• ${c}`, { indent: 20 }));
      }
    }

    doc.end();
  });
}

module.exports = { buildPdfBuffer };
