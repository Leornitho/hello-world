
function ready(fn) {
  if (document.readyState !== 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

const IBAN = 'CH3209000000893227271';
const CREDITOR = {
  name: 'La Ferme Chautems sàrl',
  addr1: '1 ch. du Champ du Boeuf',
  addr2: '1789 Lugnorre',
  country: 'CH',
};

function addDemo(row) {
  if (!('invoice_date' in row)) {
    if (!('invoice_id' in row))   { row.invoice_id   = 'F-2025-001'; }
    if (!('invoice_sum' in row))  { row.invoice_sum  = 0; }
  }
  if (!row.store) {
    row.store = {
      store_official_name: 'La Ferme Chautems sàrl',
      street: '1 ch. du Champ du Boeuf',
      city: 'Lugnorre',
      postal_code: '1789',
      email: 'info@lafermechautems.ch',
      phone: '076 693 52 98',
      website: 'lafermechautems.ch',
    };
  }
  if (!row.customer) {
    row.customer = {
      company_name: 'Client sympa',
      street: 'Une jolie rue',
      house_number: '111',
      city: 'Ville',
      postal_code: 'XXXX',
    };
  }
  if (!row.detailed_sales || row.detailed_sales.length === 0) {
    row.detailed_sales = [
      { product_format_clientside: 'Produit exemple', unit_price_final: 10.00, UI_price_format: 'CHF/kg', quantity: 3, total_price_final: 30.00 },
      { product_format_clientside: 'Autre produit',   unit_price_final: 5.50,  UI_price_format: 'CHF/pce', quantity: 2, total_price_final: 11.00 },
    ];
  }
  if (!row.detailed_orders || row.detailed_orders.length === 0) {
    row.detailed_orders = [
      { order_id: 'Pas de commande rentrée', order_date: Date.parse('2025-02-01') / 1000, order_sales_sum_final: 30.00 },
      { order_id: 'Ici devrait venir le C_2026_....', order_date: Date.parse('2025-03-01') / 1000, order_sales_sum_final: 11.00 },
    ];
  }
  return row;
}

const data = {
  invoice: '',
  status: '',
  displayMode: 'detailed',
  emailModal: { visible: false, to: '', from: '', body: '' },
};
let app = undefined;

let salesMergedTable = null;
let storesTable      = null;
let customersTable   = null;
let ordersTable      = null;
let currentRow       = null;
let currentMapping   = null;

async function fetchSalesMerged() {
  try   { salesMergedTable = await grist.docApi.fetchTable('Sales_merged'); }
  catch (e) { console.error('fetchSalesMerged failed:', e); }
}
async function fetchStores() {
  try   { storesTable = await grist.docApi.fetchTable('Stores'); }
  catch (e) { console.error('fetchStores failed:', e); }
}
async function fetchCustomers() {
  try   { customersTable = await grist.docApi.fetchTable('Customers'); }
  catch (e) { console.error('fetchCustomers failed:', e); }
}
async function fetchOrders() {
  try   { ordersTable = await grist.docApi.fetchTable('Orders'); }
  catch (e) { console.error('fetchOrders failed:', e); }
}

function getRowById(table, id) {
  if (!id || !table) return null;
  if (typeof id === 'object') return id;
  const idx = table.id.indexOf(id);
  if (idx === -1) return null;
  const result = {};
  for (const col of Object.keys(table)) { result[col] = table[col][idx]; }
  return result;
}

// Grist may deliver a RefList column either as pre-resolved objects or as integer row IDs.
// Both cases are handled here.

function getDetailedSalesForInvoice(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) return [];
  if (typeof rawList[0] === 'object' && rawList[0] !== null) {
    // Already resolved objects — extract the fields we need.
    return rawList.map(r => ({
      product_format_clientside: r.product_format_clientside,
      unit_price_final:          r.H_price_before_manual_discount ?? r.unit_price_final,
      UI_price_format:           r.UI_price_format || null,
      discount_manual:           r.discount_manual || null,
      quantity:                  r.quantity,
      total_price_final:         r.total_price_final,
    }));
  }
  // Integer row IDs — look up in salesMergedTable.
  if (!salesMergedTable) return [];
  return rawList.filter(v => typeof v === 'number' && v > 0).map(id => {
    const r = getRowById(salesMergedTable, id);
    if (!r) return null;
    return {
      product_format_clientside: r.product_format_clientside,
      unit_price_final:          r.H_price_before_manual_discount ?? r.unit_price_final,
      UI_price_format:           r.UI_price_format || null,
      discount_manual:           r.discount_manual || null,
      quantity:                  r.quantity,
      total_price_final:         r.total_price_final,
    };
  }).filter(Boolean);
}

function getDetailedOrdersForInvoice(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) return [];
  if (!ordersTable) return [];
  const t = ordersTable;
  const results = [];
  for (let i = 0; i < t.id.length; i++) {
    if (rawList.includes(t.order_id[i])) {
      results.push({
        order_id:              t.order_id[i],
        order_date:            t.order_date[i],
        order_sales_sum_final: t.order_sales_sum_final[i],
      });
    }
  }
  return results;
}

// Strip accents to ASCII — qrcodejs (loaded by Grist) treats each JS char as 2 bytes,
// so non-ASCII content exceeds its internal limit. ASCII-only stays within bounds.
function toASCII(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove combining diacritical marks
    .replace(/[^\x00-\x7F]/g, '');    // drop any remaining non-ASCII
}

// Build the Swiss QR bill data string (SIX Payment Standard, version 0200).
// Field lengths are capped to their spec maximums to keep the QR code scannable.
function generateQRData(invoice) {
  const t = (val, max) => toASCII(String(val || '')).slice(0, max);

  const amount = typeof invoice.invoice_sum === 'number'
    ? invoice.invoice_sum.toFixed(2)
    : '';
  const ref = toASCII(String(invoice.reference || '').replace(/\s/g, '')).slice(0, 25);
  const msg = t(invoice.invoice_id ? 'Facture ' + invoice.invoice_id : '', 140);

  // 31 mandatory fields, one per line, separated by \r\n.
  // Fields 9-10: empty (required for creditor type K)
  // Fields 12-18: 7 empty lines (UltimateCreditor, reserved)
  // Fields 21-27: 7 empty lines (no UltimateDebtor)
  const data = [
    'SPC',                      // 1  header
    '0200',                     // 2  version
    '1',                        // 3  coding (UTF-8)
    IBAN,                       // 4  creditor IBAN
    'K',                        // 5  creditor addr type
    t(CREDITOR.name, 70),       // 6  creditor name
    t(CREDITOR.addr1, 70),      // 7  creditor addr line 1
    t(CREDITOR.addr2, 70),      // 8  creditor addr line 2
    '',                         // 9  (empty for type K)
    '',                         // 10 (empty for type K)
    CREDITOR.country,           // 11 creditor country
    '', '', '', '', '', '', '', // 12-18 ultimate creditor (all empty)
    amount,                     // 19 amount
    'CHF',                      // 20 currency
    '', '', '', '', '', '', '', // 21-27 ultimate debtor (all empty)
    'SCOR',                     // 28 reference type
    ref,                        // 29 reference
    msg,                        // 30 unstructured message
    'EPD',                      // 31 trailer
  ].join('\r\n');

  return data;
}

function renderQR(invoice, attempt) {
  const el = document.getElementById('qr-code-container');
  if (!el) return;
  if (typeof QRCode === 'undefined') {
    if ((attempt || 0) < 15) {
      setTimeout(() => renderQR(invoice, (attempt || 0) + 1), 200);
    } else {
      el.innerHTML = '<img src="https://raw.githubusercontent.com/Leornitho/invoices_and_orders/main/QR_facture_qrcode%20only.png" alt="QR paiement" style="width:192px;height:192px;">';
    }
    return;
  }
  el.innerHTML = '';
  try {
    new QRCode(el, {
      text:         generateQRData(invoice),
      width:        192,
      height:       192,
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    console.error('QR generation failed:', e);
    el.innerHTML = '<img src="https://raw.githubusercontent.com/Leornitho/invoices_and_orders/main/QR_facture_qrcode%20only.png" alt="QR paiement" style="width:192px;height:192px;">';
  }
}

Vue.filter('currency', function(value) {
  if (typeof value !== 'number') return value || '—';
  value = Math.round(value * 100) / 100;
  value = (value === -0 ? 0 : value);
  const result = value.toLocaleString('en', { style: 'currency', currency: 'CHF' });
  return result.includes('NaN') ? value : result;
});

Vue.filter('percent', function(value) {
  if (!value && value !== 0) return '—';
  return Math.round(value * 100) + '%';
});

Vue.filter('asDateJS', function(value) {
  if (typeof value === 'number') value = new Date(value * 1000);
  const date = dayjs(value);
  return date.isValid() ? date.locale('fr').format('dddd, DD MMMM YYYY') : value;
});

function tweakUrl(url) {
  if (!url) return url;
  return url.toLowerCase().startsWith('http') ? url : 'https://' + url;
}

function handleError(err) {
  console.error(err);
  const target = app || data;
  target.invoice = '';
  target.status  = String(err).replace(/^Error: /, '');
}

function updateInvoice(row, mapping) {
  try {
    data.status = '';
    if (row === null) throw new Error('(Pas de données — sélectionnez une ligne)');

    const mapped = grist.mapColumnNames(row, mapping);
    if (mapped) Object.assign(row, mapped);

    // Resolve RefList columns to their actual rows.
    row.detailed_sales  = getDetailedSalesForInvoice(row.detailed_sales);
    row.detailed_orders = getDetailedOrdersForInvoice(row.detailed_orders);

    row.store    = getRowById(storesTable,    row.store)    || row.store;
    row.customer = getRowById(customersTable, row.customer) || row.customer;

    if (row.store && row.store.website && !row.store.Url) {
      row.store.Url = tweakUrl(row.store.website);
    }

    addDemo(row);

    row.scorRef = String(row.reference || '').replace(/(.{4})/g, '$1 ').trim();

    data.invoice = Object.assign({}, data.invoice, row);
    window.invoice = row;

    // Pass only the fields needed for QR generation — avoids leaking large Grist columns.
    const qrPayload = {
      invoice_id:  row.invoice_id,
      invoice_sum: row.invoice_sum,
      reference:   row.reference,
    };
    Vue.nextTick(() => renderQR(qrPayload));
  } catch (err) {
    handleError(err);
  }
}

ready(function() {
  grist.ready({
    requiredAccess: 'read table',
    columns: [
      { name: 'invoice_id',      type: 'Text'    },
      { name: 'invoice_sum'                       },
      { name: 'invoice_date',    type: 'Date'    },
      { name: 'store',           type: 'Int'     },
      { name: 'customer',        type: 'Int'     },
      { name: 'detailed_sales',  type: 'RefList' },
      { name: 'detailed_orders', type: 'RefList' },
      { name: 'client_note',      type: 'Text'    },
      { name: 'reference',        type: 'Text'    },
      { name: 'invoice_file_name',    type: 'Text'   },
      { name: 'file_destination_url', type: 'Text'   },
    ],
  });

  fetchSalesMerged();
  fetchStores();
  fetchCustomers();
  fetchOrders();

  grist.onRecord((row, mapping) => {
    currentRow     = row;
    currentMapping = mapping;
    const allReady = salesMergedTable && storesTable && customersTable && ordersTable;
    if (!allReady) {
      Promise.all([
        salesMergedTable ? Promise.resolve() : fetchSalesMerged(),
        storesTable      ? Promise.resolve() : fetchStores(),
        customersTable   ? Promise.resolve() : fetchCustomers(),
        ordersTable      ? Promise.resolve() : fetchOrders(),
      ])
        .then(()  => updateInvoice(row, mapping))
        .catch(() => updateInvoice(row, mapping));
    } else {
      updateInvoice(row, mapping);
    }
  });

  grist.on('message', msg => {
    if (msg.dataChange) {
      Promise.all([fetchSalesMerged(), fetchStores(), fetchCustomers(), fetchOrders()])
        .then(() => { if (currentRow) updateInvoice(currentRow, currentMapping); });
    }
    if (msg.tableId) { app.tableConnected = true; }
  });

  Vue.config.errorHandler = function(err) { handleError(err); };

  app = new Vue({
    el: '#app',
    data: data,
    methods: {
      toggleMode() {
        this.displayMode = this.displayMode === 'detailed' ? 'summary' : 'detailed';
      },
      openEmailModal() {
        const inv = this.invoice;
        const customerEmail = inv.customer && typeof inv.customer === 'object' ? (inv.customer.email || '') : '';
        const storeEmail    = inv.store    && typeof inv.store    === 'object' ? (inv.store.email    || '') : '';
        this.emailModal = {
          visible: true,
          to:   customerEmail,
          from: storeEmail,
          body: 'Bonjour, voici la facture pour les dernières commandes, à payer dans les 30 jours. Merci beaucoup, La Ferme Chautems',
        };
      },
      async confirmSendEmail() {
        const modal    = Object.assign({}, this.emailModal);
        this.emailModal.visible = false;

        const inv      = this.invoice;
        const filename = (inv.invoice_file_name || ('facture_' + (inv.invoice_id || 'export'))) + '.pdf';
        const subject  = 'Facture ' + (inv.invoice_id || '');

        const invoiceEl  = document.querySelector('.invoice');
        const paySection = document.querySelector('.payment-section');

        const MARGIN   = 10;
        const USABLE_W = 190; // mm  (210 − 2×10)
        const USABLE_H = 277; // mm  (297 − 2×10)

        const ignoreEl = el => el.classList && (
          el.classList.contains('mode-toggle') ||
          el.classList.contains('print')
        );

        // Render at a fixed A4 width so the PDF looks the same regardless of window size.
        const RENDER_PX = 794; // A4 at 96 dpi

        const fixWidth = el => {
          el._savedWidth    = el.style.width;
          el._savedMaxWidth = el.style.maxWidth;
          el.style.width    = RENDER_PX + 'px';
          el.style.maxWidth = 'none';
          void el.offsetWidth; // force reflow
        };
        const restoreWidth = el => {
          el.style.width    = el._savedWidth;
          el.style.maxWidth = el._savedMaxWidth;
        };

        try {
          // Capture invoice content with payment section hidden
          paySection.style.display = 'none';
          fixWidth(invoiceEl);
          const c1 = await html2canvas(invoiceEl, {
            scale: 2, useCORS: true, logging: false,
            windowWidth: RENDER_PX, ignoreElements: ignoreEl,
          });
          restoreWidth(invoiceEl);
          paySection.style.display = '';

          // Capture payment section separately
          fixWidth(paySection);
          const c2 = await html2canvas(paySection, {
            scale: 2, useCORS: true, logging: false, windowWidth: RENDER_PX,
          });
          restoreWidth(paySection);

          const { jsPDF } = window.jspdf;
          const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

          // Lay invoice content across as many A4 pages as needed
          const h1   = c1.height / c1.width * USABLE_W;
          const img1 = c1.toDataURL('image/jpeg', 0.95);
          for (let page = 0; page * USABLE_H < h1; page++) {
            if (page > 0) pdf.addPage();
            pdf.addImage(img1, 'JPEG', MARGIN, MARGIN - page * USABLE_H, USABLE_W, h1);
          }

          // Payment section always starts on a fresh page
          pdf.addPage();
          const h2 = c2.height / c2.width * USABLE_W;
          pdf.addImage(c2.toDataURL('image/jpeg', 0.95), 'JPEG', MARGIN, MARGIN, USABLE_W, h2);

          // Get PDF as blob so we can both download and upload
          const pdfBlob = pdf.output('blob');

          // Local download
          const dlUrl  = URL.createObjectURL(pdfBlob);
          const dlLink = document.createElement('a');
          dlLink.href     = dlUrl;
          dlLink.download = filename;
          dlLink.click();
          setTimeout(() => URL.revokeObjectURL(dlUrl), 2000);

          // Upload to kDrive dropbox if a destination URL is configured
          const destUrl = inv.file_destination_url;
          if (destUrl) {
            const m = destUrl.match(/collaborate\/(\d+)\/([0-9a-f-]+)/i);
            if (m) {
              const driveId = m[1];
              const token   = m[2];
              (async () => {
                try {
                  // SHA-512 hash of the file content (required by kDrive)
                  const buf     = await pdfBlob.arrayBuffer();
                  const hashBuf = await crypto.subtle.digest('SHA-512', buf);
                  const hash    = Array.from(new Uint8Array(hashBuf))
                                    .map(b => b.toString(16).padStart(2, '0')).join('');
                  // Random client token (UUID v4)
                  const clientToken = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
                  const params = new URLSearchParams({
                    share_link_token:  token,
                    conflict:          'rename',
                    directory_path:    '/',
                    file_name:         filename,
                    total_size:        String(pdfBlob.size),
                    last_modified_at:  String(Math.floor(Date.now() / 1000)),
                    total_chunk_hash:  'sha512:' + hash,
                    chunk_number:      '1',
                    chunk_size:        String(pdfBlob.size),
                    client_token:      clientToken,
                  });
                  // Use the public REST API (CORS-friendly) instead of the internal web-app endpoint
                  const r = await fetch(
                    'https://api.infomaniak.com/2/drive/' + driveId +
                    '/files/upload?' + params,
                    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pdfBlob }
                  );
                  if (!r.ok) r.text().then(t => console.warn('kDrive upload HTTP', r.status, t));
                  else console.log('kDrive upload OK');
                } catch(e) { console.error('kDrive upload failed:', e); }
              })();
            }
          }

          const a = document.createElement('a');
          a.href = 'mailto:' + encodeURIComponent(modal.to)
            + '?subject=' + encodeURIComponent(subject)
            + '&body='    + encodeURIComponent(modal.body);
          a.click();
        } catch(e) {
          restoreWidth(invoiceEl);
          restoreWidth(paySection);
          paySection.style.display = '';
          console.error('PDF error:', e);
        }
      },
    },
  });
});
