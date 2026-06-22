
//Pour l'instant on ne demande pas de mapper le détail, car les références paraissent un peu problématiques


/*    grist.onRecord(async (record) => {
    // On récupère les colonnes mappées
    const mapped = grist.mapColumnNames(record);

    if (mapped) {
        console.error("Toutes les colonnes sont mappées.")
       
    } else {
        // Sinon, on affiche un message d'erreur dans la console
        console.error("Toutes les colonnes n'ont pas été mappées.");
    }
});
*/ // Code copié d'un autre endroit; a priori inutile pour nous, on utilise grist.mapColumnNames directement dans la fonction update invoice

function ready(fn) {
  if (document.readyState !== 'loading'){
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}


/**
 *  Demo is only shown when the row has no Issued or Due date!
 */
function addDemo(row) { // Allows to give default values if the data isn't complete. Returns row
  if (!('order_date' in row) && !('Due' in row)) {
    for (const key of ['order_id', 'order_date']) { //Avant, on avait aussi 'Due' dans cette liste de key, pour avoir une date d'échéance.
      if (!(key in row)) { row[key] = key; }
    }
    for (const key of ['Deduction', 'order_sales_sum_final']) { //Aussi "Subtotal" comme key ici. Deduction pourrait être utilisé pour afficher le rabais client?
      if (!(key in row)) { row[key] = key; }
    }
    if (!('client_note' in row)) { row.client_note = '(Anything in a Note column goes here)'; }
  }
  if (!row.store) {
    row.store = {
      store_official_name: 'La Ferme Chautems sàrl',
      street: '1 ch. du Champ du Boeuf',
      city: 'Lugnorre',
      postal_code: '1789',
      email: 'info@lafermechautems.ch',
      phone: ' 076 693 52 98',
      website: 'lafermechautems.ch'
    }
  }
  if (!row.customer) {
    row.customer = {
      company_name: 'Client sympa',
      street: 'Une jolie rue',
      house_number: '111',
      city: 'Ville',
      State: '.State', // n'est pas utilisé
      postal_code: 'XXXX'
    }
  }
  if (!row.detailed_sales) {
    row.detailed_sales = [
      {
        product_format: 'Pas darticle dispo',
        product_format_clientside: 'problem',
        quantity: 'Quantité démo',
        total_price_final: 'prix demo',
        unit_price_final: '.prix unité démo',
      },
      {
        product_format: 'Items[1].Description',
        quantity: '.Quantity démo',
        total_price_final: 'prix demo',
        unit_price_final: '.Price unité  démo',
      },
    ];
  }
  return row;
}

const data = {
  count: 0,
  invoice: '',
  status: 'waiting',
  tableConnected: false,
  rowConnected: false,
  haveRows: false,
};
let app = undefined;

// Cache of fetched tables (columnar format from fetchTable).
let salesMergedTable = null;
let storesTable = null;
let customersTable = null;
let currentRow = null;
let currentMapping = null;

async function fetchSalesMerged() {
  try {
    salesMergedTable = await grist.docApi.fetchTable('Sales_merged');
    console.log('sales_merged fetched, columns:', Object.keys(salesMergedTable));
  } catch (e) {
    console.error('fetchSalesMerged failed:', e);
  }
}

async function fetchStores() {
  try {
    storesTable = await grist.docApi.fetchTable('Stores');
    console.log('stores fetched, columns:', Object.keys(storesTable));
  } catch (e) {
    console.error('fetchStores failed:', e);
  }
}

async function fetchCustomers() {
  try {
    customersTable = await grist.docApi.fetchTable('Customers');
    console.log('customers fetched, columns:', Object.keys(customersTable));
    console.log('customers table data:', JSON.stringify(customersTable));
  } catch (e) {
    console.error('fetchCustomers failed:', e);
  }
}

// Generic lookup: given a columnar table and a row id, return a plain object with all fields.
// If id is already an object (legacy RECORD expansion), return it as-is.
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

function getDetailsForOrder(orderId) {
  if (!salesMergedTable) return [];
  const t = salesMergedTable;
  const rows = [];
  for (let i = 0; i < t.id.length; i++) {
    if (t.order_id[i] === orderId) {
      rows.push({
        product_format_clientside: t.product_format_clientside[i],
        unit_price_final:          t.H_price_before_manual_discount ? t.H_price_before_manual_discount[i] : null,
        UI_price_format:           t.UI_price_format ? t.UI_price_format[i] : null,
        discount_manual:           t.discount_manual ? t.discount_manual[i] : null,
        quantity:                  t.quantity[i],
        total_price_final:         t.total_price_final[i],
      });
    }
  }
  return rows.sort((a, b) =>
    String(a.product_format_clientside || '').localeCompare(String(b.product_format_clientside || ''), 'fr'));
}

Vue.filter('currency', formatNumberAsCHF)
function formatNumberAsCHF(value) {
  if (typeof value !== "number") {
    return value || '—';      // falsy value would be shown as a dash.
  }
  value = Math.round(value * 100) / 100;    // Round to nearest cent.
  value = (value === -0 ? 0 : value);       // Avoid negative zero.

  const result = value.toLocaleString('en', {
    style: 'currency', currency: 'CHF'
  })
  if (result.includes('NaN')) {
    return value;
  }
  return result;
}

Vue.filter('percent', function(value) {
  if (!value && value !== 0) return '—';
  return Math.round(value * 100) + '%';
});

Vue.filter('fallback', function(value, str) {
  if (!value) {
    throw new Error("Please provide column " + str);
  }
  return value;
});



Vue.filter('asDateJS', function(value) {
  if (typeof(value) === 'number') {
    value = new Date(value * 1000);
  }
  const date = dayjs(value);
  return date.isValid() ? date.locale('fr').format('dddd, DD MMMM YYYY') : value;
});


function tweakUrl(url) {
  if (!url) { return url; }
  if (url.toLowerCase().startsWith('http')) {
    return url;
  }
  return 'https://' + url;
};

function handleError(err) {
  console.error(err);
  const target = app || data;
  target.invoice = '';
  target.status = String(err).replace(/^Error: /, '');
  console.log(data);
}

function prepareList(lst, order) { // Sert uniquement à afficher l'aide (Colones souhaitées, reconnues, manquantes etc)
  if (order) {
    let orderedLst = [];
    const remaining = new Set(lst);
    for (const key of order) {
      if (remaining.has(key)) {
        remaining.delete(key);
        orderedLst.push(key);
      }
    }
    lst = [...orderedLst].concat([...remaining].sort());
  } else {
    lst = [...lst].sort();
  }
  return lst;
}


//Fonction principale, appelée sur onRecord
function updateInvoice(row, mapping) {

console.log('before');
 console.log(JSON.stringify(row));
 console.log('mapped')
const mapped = grist.mapColumnNames(row, mapping)
console.log(JSON.stringify(mapped))

console.log('after');
 console.log(JSON.stringify(row));

let row_donnees = ''

  try {
    data.status = '';
    if (row === null) {
      throw new Error("(No data - not on row - please add or select a row)");
    }
    // Apply column mapping so that widget field names (store, customer, order_id, etc.)
    // are populated from whatever column names the user mapped in the Creator Panel.
    if (mapped) Object.assign(row, mapped);
    // Fetch line items from sales_merged, filtering by the order's row id.
    row.detailed_sales = getDetailsForOrder(row.id);
    // Look up store and customer from their respective tables using integer row IDs.
    console.log('row.store raw:', row.store, 'storesTable ready:', !!storesTable);
    console.log('row.customer raw:', row.customer, 'customersTable ready:', !!customersTable);
    row.store = getRowById(storesTable, row.store) || row.store;
    row.customer = getRowById(customersTable, row.customer) || row.customer;

     

     
    // Add some guidance about columns.
    const want = new Set(Object.keys(addDemo({}))); // Tout ce que nous donnons comme données dans addDemo (voir ci-dessous est "wanted" dans le invoice)
    const accepted = new Set();
    const importance = ['order_ID', 'customer', 'details', 'Total', 'Invoicer', 'Due', 
                        'order_date', 'Subtotal', 'Deduction', 'Taxes', 'Note', 'Paid']; // Sert uniquement à donner un ordre dans le helper
    
    
    if (!('Due' in row || 'Issued' in row)) {
      const seen = new Set(Object.keys(row).filter(k => k !== 'id' && k !== '_error_'));
      const help = row.Help = {};
      help.seen = prepareList(seen);
      const missing = [...want].filter(k => !seen.has(k));
      const ignoring = [...seen].filter(k => !want.has(k) && !accepted.has(k));
      const recognized = [...seen].filter(k => want.has(k) || accepted.has(k));
      if (missing.length > 0) {
        help.expected = prepareList(missing, importance);
      }
      if (ignoring.length > 0) {
        help.ignored = prepareList(ignoring);
      }
      if (recognized.length > 0) {
        help.recognized = prepareList(recognized);
      }
    }

    addDemo(row);

   /* if (!row.order_sales_sum_final && row.details && Array.isArray(row.details)) {
      try {
        row.order_sales_sum_final = row.Subtotal - (row.Deduction || 0);
      } catch (e) {
        console.error(e);
      }
    } */ // Inutile pour nous

    // Pour transformer l'adresse web en url valide (http: ..)
    if (row.store && row.store.website && !row.store.Url) {
      row.store.Url = tweakUrl(row.store.website);
    }

    // Fiddle around with updating Vue (I'm not an expert).
    for (const key of want) {
      Vue.delete(data.invoice, key); // Pourquoi ça ???
    }
    for (const key of ['Help', 'SuggestReferencesColumn']) {
      Vue.delete(data.invoice, key);
    }


    data.invoice = Object.assign({}, data.invoice, row);
    
    console.log(JSON.stringify(row));
    console.log(JSON.stringify(row.detailed_sales[0]));


    // Make invoice information available for debugging.
    window.invoice = row;
    
  } catch (err) { // Catch = Quoi faire si le gros bloc au-dessus (try) renvoie une exception
    handleError(err);
  }
}



ready(function() {
  // Update the invoice anytime the document data changes.
  
  
  grist.ready({ // On est obligé de mapper TOUTES les colonnes utiles dans le widget (grist core code)
   requiredAccess: 'read table',
   columns:  [{name: 'order_id', type: 'Text'},
              {name: 'order_sales_sum_final'},
              {name: 'order_date', type: 'Date'},
              {name:'store', type: 'Int'},
              {name: 'customer', type: 'Int'},
            {name: 'client_note', type: 'Text'}]
}); // Pour dire à Grist que c'est prêt. Avant: sans les options

  fetchSalesMerged(); // Initial load of the sales_merged table (after grist.ready).
  fetchStores();
  fetchCustomers();

  grist.onRecord((row, mapping) => {  //Crée tout le tsouin tsouin à balancer au HTML, à chaque évenement "onRecord"
    currentRow = row;
    currentMapping = mapping;
    const allReady = salesMergedTable && storesTable && customersTable;
    if (!allReady) {
      Promise.all([
        salesMergedTable  ? Promise.resolve() : fetchSalesMerged(),
        storesTable       ? Promise.resolve() : fetchStores(),
        customersTable    ? Promise.resolve() : fetchCustomers(),
      ]).then(() => updateInvoice(row, mapping)).catch(() => updateInvoice(row, mapping));
    } else {
      updateInvoice(row, mapping);
    }
  });


  // Monitor status so we can give user advice.
  grist.on('message', msg => {
    // Re-fetch sales_merged whenever data changes so line items stay current.
    if (msg.dataChange) {
      Promise.all([fetchSalesMerged(), fetchStores(), fetchCustomers()]).then(() => {
        if (currentRow) updateInvoice(currentRow, currentMapping);
      });
    }
    // If we are told about a table but not which row to access, check the
    // number of rows.  Currently if the table is empty, and "select by" is
    // not set, onRecord() will never be called.
    if (msg.tableId && !app.rowConnected) {
      grist.docApi.fetchSelectedTable().then(table => {
        if (table.id && table.id.length >= 1) {
          app.haveRows = true;
        }
      }).catch(e => console.log(e));
    }
    if (msg.tableId) { app.tableConnected = true; }
    if (msg.tableId && !msg.dataChange) { app.RowConnected = true; }
  });

  Vue.config.errorHandler = function (err, vm, info)  {
    handleError(err);
  };

  app = new Vue({
    el: '#app',
    data: data
  });

  if (document.location.search.includes('demo')) {
    updateInvoice(exampleData);
  }
  if (document.location.search.includes('labels')) {
    updateInvoice({});
  }
});
