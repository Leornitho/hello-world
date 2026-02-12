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
  if (!row.details) {
    row.details = [
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
 //row = grist.mapColumnNames(row, mapping) || row; // On doit reassigner uniquement ce qui a été mappé, pas tout remplacer
 // var mapped_keys = Object.keys(mapped);

console.log('after');
 console.log(JSON.stringify(row));

let row_donnees = ''

  try {
    data.status = '';
    if (row === null) {
      throw new Error("(No data - not on row - please add or select a row)");
    }
    console.log("GOT...", JSON.stringify(row));
    if (row.References) {
      try {
        Object.assign(row, row.References);
        
      } catch (err) {
        throw new Error('Could not understand References column. ' + err);
      }
    }

     

     
    // Add some guidance about columns.
    const want = new Set(Object.keys(addDemo({}))); // Tout ce que nous donnons comme données dans addDemo (voir ci-dessous est "wanted" dans le invoice)
    const accepted = new Set(['References']); // ??
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
      if (!seen.has('References') && !(row.Issued || row.Due)) {
        row.SuggestReferencesColumn = true;
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
    for (const key of ['Help', 'SuggestReferencesColumn', 'References']) {
      Vue.delete(data.invoice, key);
    }


    data.invoice = Object.assign({}, data.invoice, row);
    
    console.log(JSON.stringify(row));
    console.log(JSON.stringify(row.details[0]));


    // Make invoice information available for debugging.
    window.invoice = row;
    
  } catch (err) { // Catch = Quoi faire si le gros bloc au-dessus (try) renvoie une exception
    handleError(err);
  }
}



ready(function() {
  // Update the invoice anytime the document data changes.
  
  
  grist.ready({ // On est obligé de mapper TOUTES les colonnes utiles dans le widget (grist core code)
   columns:  [{name: 'order_id', type: 'Text'},
              {name: 'order_sales_sum_final'},
              {name: 'order_date', type: 'Date'},
              {name:'store', type:"Ref"},
              {name: 'customer', type: "Ref"},
              {name: 'details', type:"RefList"},
              {name: 'References'}]
}); // Pour dire à Grist que c'est prêt. Avant: sans les options
  
  grist.onRecord(updateInvoice);  //Crée tout le tsouin tsouin à balancer au HTML, à chaque évenement "onRecord"


  // Monitor status so we can give user advice.
  grist.on('message', msg => {
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
