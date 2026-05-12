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

function ready(fn) {
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn);
}

Vue.filter('f2', function(n) {
  return typeof n === 'number' ? n.toFixed(2) : '—';
});

const data = { slip: null, status: 'En attente…' };
let app;

function updateSlip(row) {
  try {
    if (!row) { data.slip = null; data.status = 'En attente…'; return; }

    const hours   = parseHours(row.hours);
    const gross   = r2(hours * HOURLY_RATE);
    const avs     = r2(gross * RATES.avs);
    const chomage = r2(gross * RATES.chomage);
    const accident= r2(gross * RATES.accident);
    const ijm     = r2(gross * RATES.ijm);
    const totalDed= r2(avs + chomage + accident + ijm);
    const net     = r2(gross - totalDed);

    data.slip = {
      employee_name:         row.employee_name || '',
      employee_address:      row.employee_address || '',
      employee_city:         row.employee_city || '',
      employee_nationality:  row.employee_nationality || 'Suisse',
      employee_civil_status: row.employee_civil_status || '',
      employee_children:     row.employee_children != null ? row.employee_children : 0,
      employee_avs:          row.employee_avs || '',
      employee_function:     row.employee_function || '',
      employee_iban:         row.employee_iban || '',
      firstDay: monthFirstDay(row.month),
      lastDay:  monthLastDay(row.month),
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
      { name: 'month',                 type: 'Text'    },
      { name: 'hours',                 type: 'Numeric' },
      { name: 'employee_name',         type: 'Text'    },
      { name: 'employee_address',      type: 'Text'    },
      { name: 'employee_city',         type: 'Text'    },
      { name: 'employee_nationality',  type: 'Text'    },
      { name: 'employee_civil_status', type: 'Text'    },
      { name: 'employee_children',     type: 'Int'     },
      { name: 'employee_avs',          type: 'Text'    },
      { name: 'employee_function',     type: 'Text'    },
      { name: 'employee_iban',         type: 'Text'    },
    ],
  });

  grist.onRecord((row, mapping) => {
    const mapped = grist.mapColumnNames(row, mapping);
    if (mapped) Object.assign(row, mapped);
    updateSlip(row);
  });

  app = new Vue({ el: '#app', data });
});
