const HOURLY_RATE = 20.00;

const RATES = {
  avs:      0.0530,
  chomage:  0.0110,
  accident: 0.01607,
  ijm:      0.0047,
};

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
  if (typeof id === 'object') return id;
  if (!table) return null;
  const idx = table.id.indexOf(id);
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
let currentRow = null;
let currentMapping = null;

async function fetchHeuresAlicia() {
  try {
    heuresAliciaTable = await grist.docApi.fetchTable('Heures_Alicia');
  } catch(e) {
    console.error('fetchHeuresAlicia failed:', e);
  }
}

async function fetchEmployees() {
  try {
    employeesTable = await grist.docApi.fetchTable('Employees');
    console.log('Employees fetched, columns:', Object.keys(employeesTable));
  } catch(e) {
    console.error('fetchEmployees failed:', e);
    data.status = 'Erreur: impossible de charger la table Employees — ' + e.message;
  }
}

function updateSlip(row) {
  try {
    if (!row) { data.slip = null; data.status = 'En attente…'; return; }

    console.log('row.employee:', row.employee, 'employeesTable ready:', !!employeesTable);

    // Resolve the month reference to get the "2026-04" text value.
    const monthRow = getRowById(heuresAliciaTable, row.month);
    const monthText = monthRow ? (monthRow.month || '') : String(row.month || '');

    const emp = getRowById(employeesTable, row.employee) || {};
    console.log('emp row:', JSON.stringify(emp));

    const hours   = parseHours(row.hours);
    const gross   = r2(hours * HOURLY_RATE);
    const avs     = r2(gross * RATES.avs);
    const chomage = r2(gross * RATES.chomage);
    const accident= r2(gross * RATES.accident);
    const ijm     = r2(gross * RATES.ijm);
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

  grist.onRecord((row, mapping) => {
    currentRow = row;
    currentMapping = mapping;
    const mapped = grist.mapColumnNames(row, mapping);
    if (mapped) Object.assign(row, mapped);
    const allReady = heuresAliciaTable && employeesTable;
    if (!allReady) {
      Promise.all([
        heuresAliciaTable ? Promise.resolve() : fetchHeuresAlicia(),
        employeesTable    ? Promise.resolve() : fetchEmployees(),
      ]).then(() => updateSlip(row));
    } else {
      updateSlip(row);
    }
  });

  grist.on('message', msg => {
    if (msg.dataChange) {
      Promise.all([fetchHeuresAlicia(), fetchEmployees()]).then(() => {
        if (currentRow) updateSlip(currentRow);
      });
    }
  });

  app = new Vue({ el: '#app', data });
});
