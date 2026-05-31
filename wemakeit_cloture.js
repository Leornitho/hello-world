function ready(fn) {
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn);
}

let backersTable = null;
let app;

async function fetchBackers() {
  try {
    backersTable = await grist.docApi.fetchTable('Backers_wemakeit');
  } catch(e) {
    console.error('fetchBackers failed:', e);
    if (app) app.status = 'Erreur chargement : ' + e.message;
  }
}

function buildPeople() {
  if (!backersTable) return [];
  const t = backersTable;
  const people = [];
  for (let i = 0; i < t.id.length; i++) {
    if (!t.full_name[i]) continue;
    people.push({
      id:               t.id[i],
      full_name:        t.full_name[i],
      tshirt_size:      t.tshirt_size[i]      || '',
      prefered_version: t.prefered_version[i]  || '',
      delivery:         t.delivery[i] || null,
    });
  }
  return people.sort((a, b) => a.full_name.localeCompare(b.full_name, 'fr'));
}

const data = {
  status:        '',
  people:        [],
  selectedId:    '',
  form:          { tshirt_size: '', prefered_version: '', delivery: null },
  sizes:         ['XS', 'S', 'M', 'L', 'XL'],
  variants:      ['Connaisseur', 'Gourmet'],
  deliveryOptions: [
    'Je viens chercher à la ferme (Lugnorre)',
    'Livraison par la poste',
  ],
  saving:        false,
  submitted:     false,
  submittedName: '',
};

ready(function() {
  grist.ready({ requiredAccess: 'full' });

  let initialFetched = false;
  function doInitialFetch() {
    if (initialFetched) return;
    initialFetched = true;
    fetchBackers().then(() => { if (app) app.people = buildPeople(); });
  }

  // Fire once Grist channel is ready — first message or timeout, whichever comes first
  setTimeout(doInitialFetch, 400);

  grist.on('message', msg => {
    doInitialFetch();
    if (msg.dataChange) {
      fetchBackers().then(() => { if (app) app.people = buildPeople(); });
    }
  });

  app = new Vue({
    el: '#app',
    data,
    watch: {
      selectedId: function() { this.onPersonSelect(); },
    },
    computed: {
      canSubmit() {
        return this.form.tshirt_size &&
               this.form.prefered_version &&
               this.form.delivery;
      },
    },
    methods: {
      onPersonSelect() {
        const person = this.people.find(p => p.id === this.selectedId);
        if (person) {
          this.form.tshirt_size      = person.tshirt_size;
          this.form.prefered_version = person.prefered_version;
          this.form.delivery         = person.delivery;
        } else {
          this.form = { tshirt_size: '', prefered_version: '', delivery: null };
        }
      },
      async submit() {
        if (!this.canSubmit || this.saving) return;
        this.saving = true;
        this.status = '';
        try {
          await grist.docApi.applyUserActions([['UpdateRecord', 'Backers_wemakeit', this.selectedId, {
            tshirt_size:      this.form.tshirt_size,
            prefered_version: this.form.prefered_version,
            delivery:         this.form.delivery,
          }]]);
          const person = this.people.find(p => p.id === this.selectedId);
          this.submittedName = person ? person.full_name : '';
          this.submitted = true;
        } catch(e) {
          this.status = 'Erreur lors de l\'enregistrement : ' + e.message;
        } finally {
          this.saving = false;
        }
      },
      reset() {
        this.submitted = false;
        this.status    = '';
      },
    },
  });
});
