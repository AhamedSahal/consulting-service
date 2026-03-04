const fs = require('fs');
const path = require('path');

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 200;
const COMPANY_DOC_CHUNK_SIZE = 1200;
const COMPANY_DOC_CHUNK_OVERLAP = 200;

// Max file size for extraction (bytes) - large PPTX/XLSX cause heap OOM
const MAX_EXTRACT_FILE_SIZE = 8 * 1024 * 1024; // 8MB
const XLSX_MAX_ROWS_PER_SHEET = 2000;
const XLSX_MAX_SHEETS = 5;

function cleanText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\0/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectFileType(filePath, mimeType) {
  const mime = (mimeType || '').toLowerCase();
  if (mime === 'text/plain') return 'txt';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'docx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mime === 'application/vnd.ms-powerpoint'
  ) {
    return 'pptx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel'
  ) {
    return 'xlsx';
  }

  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.txt') return 'txt';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.pptx') return 'pptx';
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx';
  if (ext === '.doc') return 'doc';
  if (ext === '.ppt') return 'ppt';
  return 'unknown';
}

function extractTextFromPptxJson(obj, parts = []) {
  if (!obj) return parts;
  if (typeof obj === 'string' && obj.trim()) {
    parts.push(obj.trim());
    return parts;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item) => extractTextFromPptxJson(item, parts));
    return parts;
  }
  if (typeof obj === 'object') {
    // xml2js uses '_' for text content in elements
    if (typeof obj._ === 'string' && obj._.trim()) {
      parts.push(obj._.trim());
    }
    Object.keys(obj).forEach((key) => {
      if (key === '_' || key === '$') return; // already handled or attributes
      extractTextFromPptxJson(obj[key], parts);
    });
  }
  return parts;
}

async function extractText(filePath, mimeType) {
  const type = detectFileType(filePath, mimeType);
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_EXTRACT_FILE_SIZE) {
    throw new Error(
      `File too large for extraction (${Math.round(stat.size / 1024 / 1024)}MB). Maximum ${MAX_EXTRACT_FILE_SIZE / 1024 / 1024}MB to avoid memory issues.`,
    );
  }

  if (type === 'txt') {
    try {
      return (await fs.promises.readFile(filePath, 'utf8')) || '';
    } catch (err) {
      try {
        return (await fs.promises.readFile(filePath, 'utf16le')) || '';
      } catch {
        // eslint-disable-next-line no-console
        console.error('Failed to read TXT file:', err);
        return '';
      }
    }
  }

  if (type === 'pdf') {
    try {
      // eslint-disable-next-line global-require
      const pdfParse = require('pdf-parse');
      const buffer = await fs.promises.readFile(filePath);
      const data = await pdfParse(buffer);
      return data.text || '';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to extract text from PDF:', err);
      return '';
    }
  }

  if (type === 'docx') {
    try {
      // eslint-disable-next-line global-require
      const mammoth = require('mammoth');
      const buffer = await fs.promises.readFile(filePath);
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to extract text from DOCX:', err);
      return '';
    }
  }

  if (type === 'pptx') {
    try {
      // eslint-disable-next-line global-require
      const PPTX2Json = require('pptx2json');
      const pptx2json = new PPTX2Json();
      const json = await pptx2json.toJson(filePath);
      const parts = extractTextFromPptxJson(json);
      return parts.join('\n');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to extract text from PPTX:', err);
      return '';
    }
  }

  if (type === 'xlsx') {
    try {
      // eslint-disable-next-line global-require
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(filePath, { cellText: true });
      const lines = [];
      const sheetNames = (workbook.SheetNames || []).slice(0, XLSX_MAX_SHEETS);
      for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet || !sheet['!ref']) continue;
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const maxRow = Math.min(range.e.r, range.s.r + XLSX_MAX_ROWS_PER_SHEET - 1);
        for (let R = range.s.r; R <= maxRow; R += 1) {
          const row = [];
          for (let C = range.s.c; C <= range.e.c; C += 1) {
            const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = sheet[cellRef];
            const val = cell && (cell.w != null ? cell.w : cell.v);
            if (val != null && String(val).trim()) {
              row.push(String(val).trim());
            }
          }
          if (row.length > 0) lines.push(row.join('\t'));
        }
      }
      return lines.join('\n');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to extract text from XLSX:', err);
      return '';
    }
  }

  // eslint-disable-next-line no-console
  console.warn(`Unsupported file type for extraction: ${filePath}`);
  return '';
}

function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
  const chunks = [];
  if (!text) return chunks;

  // Normalize parameters to avoid infinite loops and bad ranges
  let size = Number(chunkSize) || DEFAULT_CHUNK_SIZE;
  let ov = Number(overlap) || 0;

  if (size <= 0) size = DEFAULT_CHUNK_SIZE;
  if (ov < 0) ov = 0;
  if (ov >= size) ov = Math.floor(size / 4); // keep a sane overlap

  let start = 0;
  const len = text.length;

  while (start < len) {
    const end = Math.min(start + size, len);
    const slice = text.slice(start, end).trim();

    if (slice) {
      chunks.push(slice);
    }

    // If we've reached the end, break to avoid looping on short texts
    if (end >= len) break;

    start = end - ov;
    if (start < 0) start = 0;
  }

  return chunks;
}

function chunkTextForCompanyDoc(text) {
  return chunkText(text, COMPANY_DOC_CHUNK_SIZE, COMPANY_DOC_CHUNK_OVERLAP);
}

module.exports = {
  extractText,
  chunkText,
  chunkTextForCompanyDoc,
  cleanText,
  detectFileType,
};
