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
  const pivot      = {};

  for (let i = 0; i < t.id.length; i++) {
    if (!t.harvest_date[i]) continue;
    if (tsToDateStr(t.harvest_date[i]) !== data.selectedDate) continue;
    const product = String(t.H_product_format_name[i] || '?');
    const client  = String(t.H_customer_name[i] || '?');
    const qty     = Number(t.quantity[i])       || 0;

    productSet.add(product);
    clientSet.add(client);
    if (!pivot[product]) pivot[product] = {};
    pivot[product][client] = (pivot[product][client] || 0) + qty;
  }

  data.products = Array.from(productSet).sort((a, b) => a.localeCompare(b, 'fr'));
  data.clients  = Array.from(clientSet).sort((a, b)  => a.localeCompare(b, 'fr'));
  data.pivot    = pivot;

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
      qty(product, client) {
        const q = this.pivot[product] && this.pivot[product][client];
        return fmtQty(q || 0);
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
