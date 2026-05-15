
function r2(n) { return Math.round(n * 100) / 100; }

function parseHours(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && val.includes(':')) {
    const [h, m] = val.split(':').map(Number);
    return h + (m || 0) / 60;
  }
  return Number(val) || 0;
}

function fmtHours(h) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return hrs + ':' + String(mins).padStart(2, '0');
}

function monthFirstDay(month) {
  const [y, m] = (month || '').split('-');
  if (!y || !m) return '';
  return '01.' + m + '.' + y;
}

function monthLastDay(month) {
  const [y, m] = (month || '').split('-');
  if (!y || !m) return '';
  const d = new Date(parseInt(y), parseInt(m), 0).getDate();
  return String(d).padStart(2, '0') + '.' + m + '.' + y;
}

function getRowById(table, id) {
  if (!id) return null;
  if (typeof id === 'object') {
    if (id.rowId) id = id.rowId;
    else return null;
  }
  if (!table) return null;
  const idx = table.id.indexOf(id);
  if (idx === -1) return null;
  const result = {};
  for (const col of Object.keys(table)) {
    result[col] = table[col][idx];
  }
  return result;
}

function getRowByName(table, name) {
  if (!name || !table || !table.name) return null;
  const idx = table.name.indexOf(name);
  if (idx === -1) return null;
  const result = {};
  for (const col of Object.keys(table)) {
    result[col] = table[col][idx];
  }
  return result;
}

function ready(fn) {
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn);
}

Vue.filter('f2', function(n) {
  return typeof n === 'number' ? n.toFixed(2) : '—';
});

const data = { slip: null, status: 'En attente…' };
let app;
let heuresAliciaTable = null;
let employeesTable = null;
let cotisationsTable = null;
let currentRow = null;
let currentMapping = null;

async function fetchHeuresAlicia() {
  try {
    heuresAliciaTable = await grist.docApi.fetchTable('Heures_Alicia');
  } catch(e) {
    console.error('fetchHeuresAlicia failed:', e);
  }
}

async function fetchCotisations() {
  try {
    cotisationsTable = await grist.docApi.fetchTable('Cotisations');
  } catch(e) {
    console.error('fetchCotisations failed:', e);
  }
}

function getCotisationsForEmployee(empId) {
  if (!cotisationsTable || !empId) return null;
  const idx = cotisationsTable.employees.indexOf(empId);
  if (idx === -1) return null;
  const result = {};
  for (const col of Object.keys(cotisationsTable)) result[col] = cotisationsTable[col][idx];
  return result;
}

async function fetchEmployees() {
  try {
    employeesTable = await grist.docApi.fetchTable('Employees');
  } catch(e) {
    console.error('fetchEmployees failed:', e);
    data.status = 'Erreur: impossible de charger la table Employees — ' + e.message;
  }
}

function updateSlip(row) {
  try {
    if (!row) { data.slip = null; data.status = 'En attente…'; return; }


    // Resolve the month reference to get the "2026-04" text value.
    const monthRow = getRowById(heuresAliciaTable, row.month);
    const monthText = monthRow ? (monthRow.month || '') : String(row.month || '');

    // Extract numeric employee row ID for table lookups.
    let empId = row.employee;
    if (typeof empId === 'object' && empId && empId.rowId) empId = empId.rowId;

    const emp   = getRowById(employeesTable, empId)  || {};
    const cotis = getCotisationsForEmployee(empId)   || {};

    const hourlyRate  = emp.hour_salary_brutto || 0;
    const avsRate     = (cotis.AVS_AI_APG || 0) / 100;
    const chomageRate = (cotis.chomage     || 0) / 100;
    const accidentRate= (cotis.accident    || 0) / 100;
    const ijmRate     = (cotis.IJJ         || 0) / 100;

    const hours   = parseHours(row.hours);
    const gross   = r2(hours * hourlyRate);
    const avs     = r2(gross * avsRate);
    const chomage = r2(gross * chomageRate);
    const accident= r2(gross * accidentRate);
    const ijm     = r2(gross * ijmRate);
    const totalDed= r2(avs + chomage + accident + ijm);
    const net     = r2(gross - totalDed);

    data.slip = {
      employee_name:         emp.name || '',
      employee_address:      emp.address || '',
      employee_city:         emp.city || '',
      employee_nationality:  emp.nationality || 'Suisse',
      employee_civil_status: emp.civil_status || '',
      employee_children:     emp.children != null ? emp.children : 0,
      employee_avs:          emp.avs || '',
      employee_function:     emp['function'] || '',
      employee_iban:         emp.iban || '',
      firstDay: monthFirstDay(monthText),
      lastDay:  monthLastDay(monthText),
      hours,
      hoursDisplay: fmtHours(hours),
      gross, avs, chomage, accident, ijm, totalDed, net,
      hourlyRate,
      avsRatePct:      cotis.AVS_AI_APG || 0,
      chomageRatePct:  cotis.chomage     || 0,
      accidentRatePct: cotis.accident    || 0,
      ijmRatePct:      cotis.IJJ         || 0,
    };
    data.status = '';
  } catch(e) {
    console.error(e);
    data.slip = null;
    data.status = String(e);
  }
}

ready(function() {
  grist.ready({
    requiredAccess: 'read table',
    columns: [
      { name: 'month',    type: 'Ref'     },
      { name: 'hours',    type: 'Numeric' },
      { name: 'employee', type: 'Ref'     },
    ],
  });

  fetchHeuresAlicia();
  fetchEmployees();
  fetchCotisations();

  grist.onRecord((row, mapping) => {
    currentRow = row;
    currentMapping = mapping;
    const mapped = grist.mapColumnNames(row, mapping);
    if (mapped) Object.assign(row, mapped);
    const allReady = heuresAliciaTable && employeesTable && cotisationsTable;
    if (!allReady) {
      Promise.all([
        heuresAliciaTable  ? Promise.resolve() : fetchHeuresAlicia(),
        employeesTable     ? Promise.resolve() : fetchEmployees(),
        cotisationsTable   ? Promise.resolve() : fetchCotisations(),
      ]).then(() => updateSlip(row));
    } else {
      updateSlip(row);
    }
  });

  grist.on('message', msg => {
    if (msg.dataChange) {
      Promise.all([fetchHeuresAlicia(), fetchEmployees(), fetchCotisations()]).then(() => {
        if (currentRow) updateSlip(currentRow);
      });
    }
  });

  app = new Vue({ el: '#app', data });
});
