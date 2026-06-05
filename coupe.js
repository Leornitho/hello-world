function ready(fn) {
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn);
}

let salesTable = null;
let app;

function tsToDateStr(ts) {
  if (!ts && ts !== 0) return '';
  if (typeof ts === 'string') return ts.slice(0, 10);
  const d = new Date(ts * 1000);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

function fmtQty(q) {
  if (!q) return '';
  return Number.isInteger(q) ? String(q) : q.toFixed(1).replace('.', ',');
}

function fmtTotal(q) {
  if (!q) return '0';
  return Number.isInteger(q) ? String(q) : q.toFixed(1).replace('.', ',');
}

async function fetchSales() {
  try {
    salesTable = await grist.docApi.fetchTable('Sales_merged');
  } catch(e) {
    console.error('fetchSales failed:', e);
    if (app) app.status = 'Erreur chargement: ' + e.message;
  }
}

const data = {
  status: 'Chargement…',
  selectedDate: '',
  dates: [],
  products: [],
  clients: [],
  pivot: {},
  pivotMax: {},
  notes: {},
  pivotNotes: {},
  pivotStatus: {},
  productRowStatus: {},
  totalsPerClient: {},
  totalsPerProduct: {},
  grandTotal: 0,
};

function buildPivot() {
  if (!salesTable) return;
  const t = salesTable;

  // Collect unique dates
  const dateSet = new Set();
  for (let i = 0; i < t.id.length; i++) {
    if (!t.harvest_date[i]) continue;
    const d = tsToDateStr(t.harvest_date[i]);
    if (d) dateSet.add(d);
  }
  const sortedDates = Array.from(dateSet).sort().reverse();
  data.dates = sortedDates;

  if (!data.selectedDate || !dateSet.has(data.selectedDate)) {
    data.selectedDate = sortedDates[0] || '';
  }
  if (!data.selectedDate) { data.status = 'Aucune donnée disponible'; return; }

  // Build pivot for selected date
  const productSet = new Set();
  const clientSet  = new Set();
  const pivot           = {};
  const pivotMax        = {};
  const pivotActual     = {};
  const notes           = {};
  const noteAccumulator = {}; // product -> client -> Set of note strings

  for (let i = 0; i < t.id.length; i++) {
    if (!t.harvest_date[i]) continue;
    if (tsToDateStr(t.harvest_date[i]) !== data.selectedDate) continue;
    const product = String(t.H_product_format_name[i] || '?');
    const client  = String(t.H_order_id[i] || '?');
    const qty     = Number(t.quantity_planned[i]) || 0;
    const maxQty  = Number(t.quantity_max[i]) || 0;
    const actual  = Number(t.quantity[i]) || 0;

    productSet.add(product);
    clientSet.add(client);
    if (!pivot[product])         pivot[product]         = {};
    if (!pivotMax[product])      pivotMax[product]      = {};
    if (!pivotActual[product])   pivotActual[product]   = {};
    pivot[product][client]         = (pivot[product][client]         || 0) + qty;
    pivotMax[product][client]      = (pivotMax[product][client]      || 0) + maxQty;
    pivotActual[product][client]   = (pivotActual[product][client]   || 0) + actual;
    if (!notes[client] && t.H_delivery_note[i]) notes[client] = String(t.H_delivery_note[i]);
    const rowNote = String(t.note[i] || '').trim();
    if (rowNote) {
      if (!noteAccumulator[product])         noteAccumulator[product]         = {};
      if (!noteAccumulator[product][client]) noteAccumulator[product][client] = new Set();
      noteAccumulator[product][client].add(rowNote);
    }
  }

  data.products = Array.from(productSet).sort((a, b) => a.localeCompare(b, 'fr'));
  data.clients  = Array.from(clientSet).sort((a, b) => a.localeCompare(b, 'fr'));
  data.pivot    = pivot;
  data.pivotMax = pivotMax;
  data.notes = notes;
  const pivotNotes = {};
  for (const p of Array.from(productSet)) {
    pivotNotes[p] = {};
    for (const c of Array.from(clientSet)) {
      if (noteAccumulator[p] && noteAccumulator[p][c])
        pivotNotes[p][c] = Array.from(noteAccumulator[p][c]).join(' / ');
    }
  }
  data.pivotNotes = pivotNotes;

  const pivotStatus = {};
  for (const p of Array.from(productSet)) {
    pivotStatus[p] = {};
    for (const c of Array.from(clientSet)) {
      const actual  = (pivotActual[p] && pivotActual[p][c]) || 0;
      const planned = (pivot[p]       && pivot[p][c])       || 0;
      const max     = (pivotMax[p]    && pivotMax[p][c])    || 0;
      if (max > 0 && actual > max)          pivotStatus[p][c] = 'cell-red';
      else if (planned > 0 && actual >= planned) pivotStatus[p][c] = 'cell-green';
    }
  }
  data.pivotStatus = pivotStatus;

  // Product row status: green if every client either has actual >= planned > 0,
  // or has no planned quantity at all (nothing written). Red overrides everything.
  const productRowStatus = {};
  for (const p of Array.from(productSet)) {
    let allOk = true;
    for (const c of Array.from(clientSet)) {
      const status  = (pivotStatus[p] && pivotStatus[p][c]) || '';
      const planned = (pivot[p]       && pivot[p][c])       || 0;
      const actual  = (pivotActual[p] && pivotActual[p][c]) || 0;
      if (status === 'cell-red' || (planned > 0 && actual < planned)) {
        allOk = false;
        break;
      }
    }
    productRowStatus[p] = allOk ? 'cell-green' : '';
  }
  data.productRowStatus = productRowStatus;

  // Totals
  const totalsPerClient  = {};
  const totalsPerProduct = {};
  let grandTotal = 0;

  for (const c of data.clients)  totalsPerClient[c]  = 0;
  for (const p of data.products) totalsPerProduct[p] = 0;

  for (const p of data.products) {
    for (const c of data.clients) {
      const q = (pivot[p] && pivot[p][c]) || 0;
      totalsPerClient[c]  += q;
      totalsPerProduct[p] += q;
      grandTotal          += q;
    }
  }

  data.totalsPerClient  = totalsPerClient;
  data.totalsPerProduct = totalsPerProduct;
  data.grandTotal       = grandTotal;
  data.status           = '';
}

ready(function() {
  grist.ready({ requiredAccess: 'read table' });

  fetchSales().then(buildPivot);

  grist.on('message', msg => {
    if (msg.dataChange) fetchSales().then(buildPivot);
  });

  app = new Vue({
    el: '#app',
    data,
    watch: {
      selectedDate: function() { buildPivot(); }
    },
    methods: {
      fmtDateOption(d) {
        const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
        const [y, m, day] = d.split('-').map(Number);
        return d + ' – ' + days[new Date(y, m - 1, day).getDay()];
      },
      qty(product, client) {
        const q = (this.pivot[product]    && this.pivot[product][client])    || 0;
        const m = (this.pivotMax[product] && this.pivotMax[product][client]) || 0;
        const base = fmtQty(q);
        if (!base && !m) return '';
        if (!base) return '(max ' + fmtTotal(m) + ')';
        return m ? base + ' (max ' + fmtTotal(m) + ')' : base;
      },
      totalProduct(product) {
        return fmtTotal(this.totalsPerProduct[product] || 0);
      },
      totalClient(client) {
        return fmtTotal(this.totalsPerClient[client] || 0);
      },
      fmtGrand() {
        return fmtTotal(this.grandTotal);
      }
    }
  });
});
