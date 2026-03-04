const fs = require('fs');
const path = require('path');

const PDFDocument = require('pdfkit');

// DOCX generation uses a lightweight library. Make sure `docx` is installed.
// npm install docx
let Docx;
try {
  // Lazy-load so tests or environments without docx can still run other code.
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  Docx = require('docx');
} catch (err) {
  Docx = null;
}

function getJdExportDir(rootDir, jdId) {
  const exportsRoot = path.join(rootDir, 'uploads', 'jds', String(jdId));
  return exportsRoot;
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function generatePdfFromMarkdown(markdown, rootDir, jdId) {
  const exportDir = getJdExportDir(rootDir, jdId);
  await ensureDir(exportDir);

  const filename = `jd_${jdId}.pdf`;
  const absPath = path.join(exportDir, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(absPath);

    doc.pipe(stream);

    const lines = String(markdown || '').split(/\r?\n/);
    lines.forEach((line) => {
      doc.text(line || '', { align: 'left' });
      doc.moveDown(0.2);
    });

    doc.end();

    stream.on('finish', () => {
      const relativePath = path.join('uploads', 'jds', String(jdId), filename);
      resolve({ absPath, relativePath });
    });
    stream.on('error', reject);
  });
}

async function generateDocxFromMarkdown(markdown, rootDir, jdId) {
  if (!Docx) {
    throw new Error('DOCX export is not available. Install the "docx" package first.');
  }

  const exportDir = getJdExportDir(rootDir, jdId);
  await ensureDir(exportDir);

  const filename = `jd_${jdId}.docx`;
  const absPath = path.join(exportDir, filename);

  const { Document, Packer, Paragraph } = Docx;

  const lines = String(markdown || '').split(/\r?\n/);
  const paragraphs = lines.map(
    (line) =>
      new Paragraph({
        text: line || '',
      }),
  );

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  const buffer = await Packer.toBuffer(doc);
  await fs.promises.writeFile(absPath, buffer);

  const relativePath = path.join('uploads', 'jds', String(jdId), filename);
  return { absPath, relativePath };
}

module.exports = {
  generatePdfFromMarkdown,
  generateDocxFromMarkdown,
};

