const ExcelJS = require('exceljs');

async function buildExcelBuffer(jdJson) {
  const wb = new ExcelJS.Workbook();
  const j = jdJson || {};

  // Summary sheet
  const summarySheet = wb.addWorksheet('Summary', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
  summarySheet.columns = [{ width: 25 }, { width: 50 }];
  const summaryRows = [
    ['Job Title', j.job_title || ''],
    ['Reports To', j.reports_to || ''],
    ['Level', j.level || ''],
    ['Department / Job Family', j.job_family || j.department || ''],
    ['Role Summary', j.role_summary || '']
  ];
  summarySheet.addRows(summaryRows);
  summarySheet.getRow(1).font = { bold: true };

  // Responsibilities sheet
  const respSheet = wb.addWorksheet('Responsibilities');
  respSheet.columns = [{ width: 30 }, { width: 60 }];
  if (j.responsibilities && typeof j.responsibilities === 'object') {
    for (const [bucket, items] of Object.entries(j.responsibilities)) {
      respSheet.addRow([bucket || 'General', '']).font = { bold: true };
      (items || []).forEach((item) => respSheet.addRow(['', item]));
    }
  }

  // KPIs sheet
  const kpiSheet = wb.addWorksheet('KPIs');
  kpiSheet.columns = [{ width: 60 }];
  if (j.kpis && j.kpis.length) {
    j.kpis.forEach((k) => kpiSheet.addRow([k]));
  }

  // Competencies sheet
  const compSheet = wb.addWorksheet('Competencies');
  compSheet.columns = [{ width: 25 }, { width: 50 }];
  if (j.competencies) {
    if (j.competencies.technical?.length) {
      compSheet.addRow(['Technical', '']).font = { bold: true };
      j.competencies.technical.forEach((c) => compSheet.addRow(['', c]));
    }
    if (j.competencies.behavioral?.length) {
      compSheet.addRow(['Behavioral', '']).font = { bold: true };
      j.competencies.behavioral.forEach((c) => compSheet.addRow(['', c]));
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

module.exports = { buildExcelBuffer };
