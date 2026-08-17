/*  =============================================================
    PIRANHA VIBES — Google Sheets backend  (Google Apps Script)
    -------------------------------------------------------------
    One file. Deploy it as a Web App and your Google Sheet becomes
    the database for products, pricing, stock, orders and settings.

    QUICK START  (full walkthrough in SETUP.md)
      1. Create a Google Sheet. Extensions ▸ Apps Script.
         (A standalone project from script.google.com also works — see
          SHEET_ID below.)
      2. Replace Code.gs with this file. Save.
      3. Project Settings ▸ Script Properties ▸ add:
            ADMIN_KEY   = a strong password of your choice
            NOTIFY_EMAIL= piranhavibes@gmail.com   (optional)
         Optional, to push admin-uploaded product images
         straight into your GitHub repo (see IMAGE UPLOAD below;
         leave these blank and images go to Google Drive instead):
            GH_TOKEN    = fine-grained PAT, Contents: Read & Write
            GH_REPO     = your-username/your-repo
            GH_BRANCH   = main
         Only for STANDALONE projects (not needed if you opened this
         script from inside a Sheet):
            SHEET_ID    = the long ID from the spreadsheet URL, i.e.
                          docs.google.com/spreadsheets/d/<SHEET_ID>/edit
         Leave SHEET_ID out and setup() creates the spreadsheet for you
         and saves its ID here automatically.
      4. Run  setup()  once  (Run ▸ setup) and grant permissions.
      5. Deploy ▸ New deployment ▸ Web app
            Execute as: Me      Who has access: Anyone
      6. Copy the /exec URL into assets/js/config.js → API_URL
    ============================================================= */

var SHEETS = {
  products: 'Products',
  orders: 'Orders',
  items: 'OrderItems',
  settings: 'Settings',
  coupons: 'Coupons',
  contacts: 'Contacts',
  subs: 'Subscribers'
};

var HEADERS = {
  Products: ['sku','slug','name','category','price','mrp','stock','sizes','colors','badge','featured','active','image','desc'],
  Orders: ['id','createdAt','status','customer','phone','email','addr1','addr2','landmark','city','state','pincode',
           'itemCount','subtotal','discount','coupon','shipping','codFee','tax','total','paymentMethod','txnRef',
           'notes','courier','trackingId','adminNote','source','updatedAt'],
  OrderItems: ['orderId','createdAt','sku','slug','name','size','color','qty','price','lineTotal'],
  Settings: ['key','value'],
  Coupons: ['code','type','value','minOrder','active'],
  Contacts: ['createdAt','name','phone','email','message'],
  Subscribers: ['createdAt','email']
};

var DEFAULT_SETTINGS = {
  shippingFee: 60,
  freeShippingAbove: 999,
  codEnabled: 1,
  codFee: 0,
  taxPercent: 0,
  upiId: 'piranhavibes@upi',
  announcement: ''
};

/* ==========================================================
   SETUP — run once from the Apps Script editor
   ========================================================== */
function setup() {
  var book = ss();

  Object.keys(HEADERS).forEach(function (name) {
    var sh = book.getSheetByName(name);
    if (!sh) sh = book.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
      sh.getRange(1, 1, 1, HEADERS[name].length)
        .setFontWeight('bold').setBackground('#0c0e2b').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  });

  var st = book.getSheetByName(SHEETS.settings);
  if (st.getLastRow() < 2) {
    var rows = Object.keys(DEFAULT_SETTINGS).map(function (k) {
      return [k, DEFAULT_SETTINGS[k]];
    });
    st.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  var cp = book.getSheetByName(SHEETS.coupons);
  if (cp.getLastRow() < 2) {
    cp.getRange(2, 1, 2, 5).setValues([
      ['VIBES10', 'percent', 10, 799, 1],
      ['FLAT50', 'flat', 50, 599, 1]
    ]);
  }

  var pr = book.getSheetByName(SHEETS.products);
  if (pr.getLastRow() < 2) {
    pr.getRange(2, 1, SEED.length, HEADERS.Products.length).setValues(SEED);
    pr.autoResizeColumns(1, 4);
  }

  // A brand-new spreadsheet ships with an empty "Sheet1" — drop it.
  var def = book.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && book.getSheets().length > 1) {
    book.deleteSheet(def);
  }

  var msg =
    'Piranha Vibes backend ready — ' + SEED.length + ' products seeded.\n' +
    'Spreadsheet: ' + book.getName() + '\n' +
    'Open it here: ' + book.getUrl();

  Logger.log(msg);
  // Only bound scripts have a UI to toast into.
  try { SpreadsheetApp.getActive().toast('Backend ready — ' + SEED.length + ' products seeded.'); } catch (e) {}
  return msg;
}

/* Prints where the database lives — handy if you lose the tab. */
function openDatabase() {
  var url = ss().getUrl();
  Logger.log('Spreadsheet URL: ' + url);
  return url;
}

/* ==========================================================
   ROUTING
   ========================================================== */
function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  var out;
  try {
    if (p.action === 'catalog') out = catalog();
    else if (p.action === 'track') out = trackOrder(p.id, p.phone);
    else if (p.action === 'adminPing') out = requireKey(p.key) ? { ok: true } : { ok: false, error: 'Invalid key' };
    else if (p.action === 'adminData') out = requireKey(p.key) ? adminData() : { ok: false, error: 'Invalid key' };
    else if (p.data) out = route(JSON.parse(decodeURIComponent(p.data)));
    else out = { ok: true, service: 'Piranha Vibes API', version: 1 };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return reply(out, p.callback);
}

function doPost(e) {
  var out;
  try {
    out = route(JSON.parse(e.postData.contents));
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return reply(out, null);
}

function route(body) {
  var a = body.action;
  var d = body.payload || {};

  // public
  if (a === 'catalog') return catalog();
  if (a === 'createOrder') return createOrder(d);
  if (a === 'track') return trackOrder(d.id, d.phone);
  if (a === 'contact') return saveContact(d);
  if (a === 'subscribe') return saveSubscriber(d);

  // admin
  if (!requireKey(d.key)) return { ok: false, error: 'Invalid or missing admin key' };
  if (a === 'adminPing') return { ok: true };
  if (a === 'adminData') return adminData();
  if (a === 'uploadImage') return uploadImage(d);
  if (a === 'storageStatus') return storageStatus();
  if (a === 'updateOrderStatus') return updateOrderStatus(d.id, d.status);
  if (a === 'updateOrderMeta') return updateOrderMeta(d);
  if (a === 'updateProducts') return updateProducts(d.updates || []);
  if (a === 'updateProduct') return upsertProduct(d, false);
  if (a === 'createProduct') return upsertProduct(d, true);
  if (a === 'deleteProduct') return deleteProduct(d.slug);
  if (a === 'saveCoupon') return saveCoupon(d);
  if (a === 'deleteCoupon') return deleteCoupon(d.code);
  if (a === 'updateSettings') return updateSettings(d);

  return { ok: false, error: 'Unknown action: ' + a };
}

function reply(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function requireKey(key) {
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!real && String(key) === String(real);
}

/* ==========================================================
   SHEET HELPERS
   ========================================================== */
/*  Resolves the spreadsheet that acts as the database.

    Works for both project styles:
      • Bound script  — created via a Sheet's Extensions ▸ Apps Script.
                        getActiveSpreadsheet() gives us the parent.
      • Standalone    — created at script.google.com. There is no active
                        spreadsheet, so we use the SHEET_ID script property;
                        if that isn't set either, we create the database
                        automatically and remember its ID.

    Set SHEET_ID in Project Settings ▸ Script Properties to point the script
    at a specific spreadsheet (paste the long ID from its URL:
    docs.google.com/spreadsheets/d/THIS_PART/edit).                          */
var _BOOK = null;

function ss() {
  if (_BOOK) return _BOOK;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');

  if (id) {
    try {
      _BOOK = SpreadsheetApp.openById(String(id).trim());
      return _BOOK;
    } catch (e) {
      throw new Error(
        'SHEET_ID is set to "' + id + '" but that spreadsheet could not be opened. ' +
        'Paste only the ID from the URL (the part between /d/ and /edit), ' +
        'and make sure this Google account can edit it. Original error: ' + e.message
      );
    }
  }

  _BOOK = SpreadsheetApp.getActiveSpreadsheet();
  if (_BOOK) return _BOOK;

  // Standalone project with nothing configured — create the database once.
  _BOOK = SpreadsheetApp.create('Piranha Vibes — Store DB');
  props.setProperty('SHEET_ID', _BOOK.getId());
  Logger.log('Created a new database spreadsheet: ' + _BOOK.getUrl());
  return _BOOK;
}

function sheet(name) {
  var s = ss().getSheetByName(name);
  if (!s) { setup(); s = ss().getSheetByName(name); }
  return s;
}

function readTable(name) {
  var sh = sheet(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = HEADERS[name];
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  return vals
    .filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
}

function findRow(name, colIndex, value) {
  var sh = sheet(name);
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var col = sh.getRange(2, colIndex, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim().toUpperCase() === String(value).trim().toUpperCase()) return i + 2;
  }
  return -1;
}

function iso(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/* ==========================================================
   PUBLIC — catalog
   ========================================================== */
function readSettings() {
  var out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = DEFAULT_SETTINGS[k]; });
  readTable(SHEETS.settings).forEach(function (r) {
    var v = r.value;
    if (v === 'TRUE' || v === true) v = 1;
    if (v === 'FALSE' || v === false) v = 0;
    out[String(r.key)] = v;
  });
  return out;
}

function catalog() {
  var products = readTable(SHEETS.products).map(function (p) {
    return {
      sku: p.sku, slug: p.slug, name: p.name, category: p.category,
      price: Number(p.price) || 0, mrp: Number(p.mrp) || 0,
      stock: Number(p.stock) || 0,
      sizes: String(p.sizes || ''), colors: String(p.colors || ''),
      badge: p.badge || '', featured: Number(p.featured) ? 1 : 0,
      active: Number(p.active) ? 1 : 0,
      image: p.image || '', desc: p.desc || ''
    };
  }).filter(function (p) { return p.slug; });

  var coupons = readTable(SHEETS.coupons).map(function (c) {
    return {
      code: String(c.code).toUpperCase(), type: String(c.type || 'percent'),
      value: Number(c.value) || 0, minOrder: Number(c.minOrder) || 0,
      active: Number(c.active) ? 1 : 0
    };
  }).filter(function (c) { return c.code; });

  return { ok: true, products: products, coupons: coupons, settings: readSettings() };
}

/* ==========================================================
   PUBLIC — create order
   ========================================================== */
function newOrderId() {
  var d = new Date();
  var p = function (n) { return ('0' + n).slice(-2); };
  var rnd = '';
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (var i = 0; i < 4; i++) rnd += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'PV' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + rnd;
}

function createOrder(d) {
  if (!d || !d.name || !d.phone || !d.items || !d.items.length) {
    return { ok: false, error: 'Incomplete order' };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var id = newOrderId();
    while (findRow(SHEETS.orders, 1, id) !== -1) id = newOrderId();

    var now = new Date();
    var oSheet = sheet(SHEETS.orders);
    oSheet.appendRow([
      id, now, 'New', d.name, "'" + String(d.phone), d.email || '',
      d.addr1 || '', d.addr2 || '', d.landmark || '', d.city || '', d.state || '',
      "'" + String(d.pincode || ''),
      Number(d.itemCount) || 0, Number(d.subtotal) || 0, Number(d.discount) || 0,
      d.coupon || '', Number(d.shipping) || 0, Number(d.codFee) || 0, Number(d.tax) || 0,
      Number(d.total) || 0, d.paymentMethod || '', d.txnRef || '',
      d.notes || '', '', '', '', d.source || '', now
    ]);

    var iSheet = sheet(SHEETS.items);
    var rows = d.items.map(function (i) {
      return [id, now, i.sku || '', i.slug || '', i.name || '', i.size || '', i.color || '',
              Number(i.qty) || 0, Number(i.price) || 0, Number(i.lineTotal) || 0];
    });
    iSheet.getRange(iSheet.getLastRow() + 1, 1, rows.length, HEADERS.OrderItems.length).setValues(rows);

    decrementStock(d.items);
    notify(id, d);

    return { ok: true, orderId: id };
  } finally {
    lock.releaseLock();
  }
}

function decrementStock(items) {
  var sh = sheet(SHEETS.products);
  var last = sh.getLastRow();
  if (last < 2) return;
  var slugCol = HEADERS.Products.indexOf('slug') + 1;
  var stockCol = HEADERS.Products.indexOf('stock') + 1;
  var slugs = sh.getRange(2, slugCol, last - 1, 1).getValues();
  var stocks = sh.getRange(2, stockCol, last - 1, 1).getValues();

  items.forEach(function (it) {
    for (var i = 0; i < slugs.length; i++) {
      if (String(slugs[i][0]) === String(it.slug)) {
        var cur = Number(stocks[i][0]) || 0;
        stocks[i][0] = Math.max(0, cur - (Number(it.qty) || 0));
        break;
      }
    }
  });
  sh.getRange(2, stockCol, last - 1, 1).setValues(stocks);
}

function notify(id, d) {
  try {
    var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
    if (!to) return;
    var lines = d.items.map(function (i) {
      return '• ' + i.name + ' (' + [i.size, i.color].filter(String).join(', ') + ') × ' + i.qty + ' — ₹' + i.lineTotal;
    }).join('\n');
    MailApp.sendEmail(to, 'New order ' + id + ' — ₹' + d.total,
      'Order ID: ' + id + '\n' +
      'Customer: ' + d.name + '  ' + d.phone + '  ' + (d.email || '') + '\n' +
      'Address: ' + [d.addr1, d.addr2, d.landmark, d.city, d.state, d.pincode].filter(String).join(', ') + '\n' +
      'Payment: ' + d.paymentMethod + (d.txnRef ? ' (UTR ' + d.txnRef + ')' : '') + '\n\n' +
      lines + '\n\n' +
      'Subtotal ₹' + d.subtotal + '\nDiscount ₹' + d.discount + '\nShipping ₹' + d.shipping +
      '\nTOTAL ₹' + d.total + '\n\n' +
      (d.notes ? 'Customer note: ' + d.notes + '\n' : ''));
  } catch (e) { /* notification is best-effort */ }
}

/* ==========================================================
   PUBLIC — track / contact / subscribe
   ========================================================== */
function trackOrder(id, phone) {
  if (!id) return { ok: false, error: 'Order ID required' };
  var row = findRow(SHEETS.orders, 1, id);
  if (row === -1) return { ok: false, error: 'Order not found' };

  var sh = sheet(SHEETS.orders);
  var vals = sh.getRange(row, 1, 1, HEADERS.Orders.length).getValues()[0];
  var o = {};
  HEADERS.Orders.forEach(function (h, i) { o[h] = vals[i]; });

  var stored = String(o.phone).replace(/\D/g, '').slice(-10);
  var given = String(phone || '').replace(/\D/g, '').slice(-10);
  if (given && stored && given !== stored) return { ok: false, error: 'Order not found' };

  var items = readTable(SHEETS.items)
    .filter(function (r) { return String(r.orderId) === String(o.id); })
    .map(function (r) {
      return { sku: r.sku, name: r.name, size: r.size, color: r.color,
               qty: Number(r.qty), price: Number(r.price), lineTotal: Number(r.lineTotal) };
    });

  return {
    ok: true,
    order: {
      id: o.id, status: o.status || 'New', createdAt: iso(o.createdAt),
      customer: o.customer, total: Number(o.total) || 0,
      courier: o.courier || '', trackingId: o.trackingId || '', items: items
    }
  };
}

function saveContact(d) {
  sheet(SHEETS.contacts).appendRow([new Date(), d.name || '', "'" + String(d.phone || ''), d.email || '', d.message || '']);
  return { ok: true };
}

function saveSubscriber(d) {
  if (!d.email) return { ok: false, error: 'Email required' };
  if (findRow(SHEETS.subs, 2, d.email) !== -1) return { ok: true, already: true };
  sheet(SHEETS.subs).appendRow([new Date(), d.email]);
  return { ok: true };
}

/* ==========================================================
   ADMIN
   ========================================================== */
function adminData() {
  var itemsByOrder = {};
  readTable(SHEETS.items).forEach(function (r) {
    var k = String(r.orderId);
    if (!itemsByOrder[k]) itemsByOrder[k] = [];
    itemsByOrder[k].push({
      sku: r.sku, slug: r.slug, name: r.name, size: r.size, color: r.color,
      qty: Number(r.qty) || 0, price: Number(r.price) || 0, lineTotal: Number(r.lineTotal) || 0
    });
  });

  var orders = readTable(SHEETS.orders).map(function (o) {
    return {
      id: o.id, createdAt: iso(o.createdAt), status: o.status || 'New',
      customer: o.customer, phone: String(o.phone).replace(/^'/, ''),
      email: o.email, addr1: o.addr1, addr2: o.addr2, landmark: o.landmark,
      city: o.city, state: o.state, pincode: String(o.pincode).replace(/^'/, ''),
      itemCount: Number(o.itemCount) || 0, subtotal: Number(o.subtotal) || 0,
      discount: Number(o.discount) || 0, coupon: o.coupon,
      shipping: Number(o.shipping) || 0, codFee: Number(o.codFee) || 0,
      tax: Number(o.tax) || 0, total: Number(o.total) || 0,
      paymentMethod: o.paymentMethod, txnRef: String(o.txnRef || ''),
      notes: o.notes, courier: o.courier, trackingId: String(o.trackingId || ''),
      adminNote: o.adminNote, items: itemsByOrder[String(o.id)] || []
    };
  }).reverse();

  var c = catalog();
  var contacts = readTable(SHEETS.contacts).map(function (r) {
    return { createdAt: iso(r.createdAt), name: r.name,
             phone: String(r.phone).replace(/^'/, ''), email: r.email, message: r.message };
  }).reverse();

  return { ok: true, orders: orders, products: c.products, coupons: c.coupons,
           settings: c.settings, contacts: contacts };
}

function updateOrderStatus(id, status) {
  var row = findRow(SHEETS.orders, 1, id);
  if (row === -1) return { ok: false, error: 'Order not found' };
  var sh = sheet(SHEETS.orders);
  sh.getRange(row, HEADERS.Orders.indexOf('status') + 1).setValue(status);
  sh.getRange(row, HEADERS.Orders.indexOf('updatedAt') + 1).setValue(new Date());
  return { ok: true };
}

function updateOrderMeta(d) {
  var row = findRow(SHEETS.orders, 1, d.id);
  if (row === -1) return { ok: false, error: 'Order not found' };
  var sh = sheet(SHEETS.orders);
  ['courier', 'trackingId', 'adminNote'].forEach(function (f) {
    if (d[f] !== undefined) sh.getRange(row, HEADERS.Orders.indexOf(f) + 1).setValue(d[f]);
  });
  sh.getRange(row, HEADERS.Orders.indexOf('updatedAt') + 1).setValue(new Date());
  return { ok: true };
}

function updateProducts(updates) {
  var sh = sheet(SHEETS.products);
  var n = 0;
  updates.forEach(function (u) {
    var row = findRow(SHEETS.products, HEADERS.Products.indexOf('slug') + 1, u.slug);
    if (row === -1) return;
    ['price', 'mrp', 'stock', 'featured', 'badge', 'active'].forEach(function (f) {
      if (u[f] !== undefined) sh.getRange(row, HEADERS.Products.indexOf(f) + 1).setValue(u[f]);
    });
    n++;
  });
  return { ok: true, updated: n };
}

function upsertProduct(d, isNew) {
  var slugCol = HEADERS.Products.indexOf('slug') + 1;
  var row = findRow(SHEETS.products, slugCol, d.slug);
  if (isNew && row !== -1) return { ok: false, error: 'A product with that slug already exists' };
  if (!isNew && row === -1) return { ok: false, error: 'Product not found' };

  var sh = sheet(SHEETS.products);
  var values = HEADERS.Products.map(function (h) {
    return d[h] !== undefined ? d[h] : '';
  });
  if (isNew) sh.appendRow(values);
  else sh.getRange(row, 1, 1, HEADERS.Products.length).setValues([values]);
  return { ok: true };
}

function deleteProduct(slug) {
  var row = findRow(SHEETS.products, HEADERS.Products.indexOf('slug') + 1, slug);
  if (row === -1) return { ok: false, error: 'Product not found' };
  sheet(SHEETS.products).deleteRow(row);
  return { ok: true };
}

function saveCoupon(d) {
  var row = findRow(SHEETS.coupons, 1, d.code);
  var vals = [String(d.code).toUpperCase(), d.type, Number(d.value) || 0,
              Number(d.minOrder) || 0, Number(d.active) ? 1 : 0];
  var sh = sheet(SHEETS.coupons);
  if (row === -1) sh.appendRow(vals);
  else sh.getRange(row, 1, 1, 5).setValues([vals]);
  return { ok: true };
}

function deleteCoupon(code) {
  var row = findRow(SHEETS.coupons, 1, code);
  if (row === -1) return { ok: false, error: 'Coupon not found' };
  sheet(SHEETS.coupons).deleteRow(row);
  return { ok: true };
}

function updateSettings(d) {
  var sh = sheet(SHEETS.settings);
  Object.keys(d).forEach(function (k) {
    if (k === 'key') return;
    var row = findRow(SHEETS.settings, 1, k);
    if (row === -1) sh.appendRow([k, d[k]]);
    else sh.getRange(row, 2).setValue(d[k]);
  });
  return { ok: true };
}

/* ==========================================================
   IMAGE UPLOAD
   ----------------------------------------------------------
   The admin panel sends a compressed image as base64. This
   function stores it and returns a public URL, WITHOUT the
   browser ever seeing a credential — everything below reads
   its secrets from Script Properties, which live inside your
   own Google account and are never sent to the client.

   Two backends, picked automatically:

   A) GitHub  — used when GH_TOKEN + GH_REPO are set. Commits
      the file straight into your repo, so the image is part of
      the codebase exactly like the seeded product photos.

   B) Google Drive — the fallback when no GitHub token is set.
      Zero extra credentials: the script already has access to
      your Drive. The file is made link-public and served from
      Google's image CDN.

   Script Properties for the GitHub route:
     GH_TOKEN     fine-grained PAT, Contents: Read & Write,
                  scoped to the one repo (see SETUP.md)
     GH_REPO      "your-username/your-repo"
     GH_BRANCH    default "main"
     GH_IMAGE_DIR default "assets/img/products"
     GH_IMAGE_URL "relative" (default) | "raw" | "jsdelivr"
   ========================================================== */

function ghConfig() {
  var p = PropertiesService.getScriptProperties();
  return {
    token: p.getProperty('GH_TOKEN'),
    repo: p.getProperty('GH_REPO'),
    branch: p.getProperty('GH_BRANCH') || 'main',
    dir: (p.getProperty('GH_IMAGE_DIR') || 'assets/img/products').replace(/^\/|\/$/g, ''),
    urlMode: p.getProperty('GH_IMAGE_URL') || 'relative'
  };
}

function storageStatus() {
  var g = ghConfig();
  var url = '';
  try { url = ss().getUrl(); } catch (e) {}
  return {
    ok: true,
    backend: (g.token && g.repo) ? 'github' : 'drive',
    repo: g.repo || '',
    branch: g.branch,
    dir: g.dir,
    urlMode: g.urlMode,
    sheetUrl: url
  };
}

function safeFileName(name) {
  var dot = String(name).lastIndexOf('.');
  var base = dot > 0 ? String(name).slice(0, dot) : String(name);
  var ext = dot > 0 ? String(name).slice(dot + 1).toLowerCase() : 'webp';
  if (['webp', 'jpg', 'jpeg', 'png', 'gif', 'avif'].indexOf(ext) === -1) ext = 'webp';
  base = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!base) base = 'product';
  return base + '.' + ext;
}

function uploadImage(d) {
  if (!d || !d.base64) return { ok: false, error: 'No image data received' };
  var name = safeFileName(d.filename || 'product.webp');
  var mime = d.mime || 'image/webp';
  var g = ghConfig();
  return (g.token && g.repo) ? uploadToGitHub(name, d.base64, g)
                             : uploadToDrive(name, d.base64, mime);
}

/* ---------- A. GitHub ---------- */
function uploadToGitHub(name, base64, g) {
  var path = g.dir + '/' + name;
  var api = 'https://api.github.com/repos/' + g.repo + '/contents/' +
            path.split('/').map(encodeURIComponent).join('/');
  var headers = {
    Authorization: 'Bearer ' + g.token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // If the file already exists we must send its blob sha to overwrite it.
  var sha = null;
  var probe = UrlFetchApp.fetch(api + '?ref=' + encodeURIComponent(g.branch), {
    headers: headers, muteHttpExceptions: true
  });
  if (probe.getResponseCode() === 200) {
    try { sha = JSON.parse(probe.getContentText()).sha; } catch (e) {}
  }

  var body = {
    message: (sha ? 'Update' : 'Add') + ' product image: ' + name,
    content: base64,
    branch: g.branch
  };
  if (sha) body.sha = sha;

  var res = UrlFetchApp.fetch(api, {
    method: 'put',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code !== 200 && code !== 201) {
    var msg = 'GitHub upload failed (' + code + ')';
    try { msg += ': ' + JSON.parse(res.getContentText()).message; } catch (e) {}
    if (code === 401 || code === 403) msg += ' — check GH_TOKEN and its repository permissions.';
    if (code === 404) msg += ' — check GH_REPO and GH_BRANCH, and that the token can see this repo.';
    return { ok: false, error: msg };
  }

  var raw = 'https://raw.githubusercontent.com/' + g.repo + '/' + g.branch + '/' + path;
  var cdn = 'https://cdn.jsdelivr.net/gh/' + g.repo + '@' + g.branch + '/' + path;
  var url = g.urlMode === 'raw' ? raw : (g.urlMode === 'jsdelivr' ? cdn : path);

  return {
    ok: true, backend: 'github', url: url, path: path,
    rawUrl: raw, cdnUrl: cdn, committed: true,
    note: g.urlMode === 'relative'
      ? 'Committed to ' + g.repo + '. GitHub Pages usually publishes it within a minute.'
      : 'Committed to ' + g.repo + ' and served immediately.'
  };
}

/* ---------- B. Google Drive ---------- */
function uploadToDrive(name, base64, mime) {
  var folderName = 'Piranha Vibes — Product Images';
  var it = DriveApp.getFoldersByName(folderName);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);

  // Replace an existing file of the same name so re-uploads don't pile up.
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);

  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, name);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var id = file.getId();
  return {
    ok: true, backend: 'drive',
    url: 'https://lh3.googleusercontent.com/d/' + id + '=w1200',
    path: folderName + '/' + name,
    note: 'Saved to your Google Drive and shared publicly. Add GH_TOKEN + GH_REPO in Script Properties to commit images to GitHub instead.'
  };
}

/* ==========================================================
   SEED CATALOGUE — mirrors assets/js/data.js
   sku, slug, name, category, price, mrp, stock, sizes, colors,
   badge, featured, active, image, desc
   ========================================================== */
var K = '22|24|26|28|30|32';
var M = 'S|M|L|XL|2XL|3XL';
var W = 'S|M|L|XL|2XL';
var I = '0-6M|6-12M|12-18M|18-24M';
var KD = "Playful Marathi slogans on premium combed cotton that kids love and parents trust. Pre-shrunk, colour-locked and built to survive endless play and washing.";
var MD = "A witty Marathi line on heavyweight bio-washed cotton. Relaxed drop-shoulder fit, ribbed collar and a print that holds its colour wash after wash.";
var WD = "Empowering Marathi typography on soft, breathable cotton with a flattering modern cut. Made to move from morning chai to late-evening plans.";
var TD = "Heavy 12oz canvas tote with reinforced handles and a roomy main compartment. Eco-friendly, reusable and printed with an original Marathi motif.";

var SEED = [
['PV-KID-DHP','dhampuklya','Dhampuklya','kids',399,0,24,K,'Mustard','Bestseller',1,1,'assets/img/products/dhampuklya.webp',KD],
['PV-KID-LDB','ladubai','Ladubai','kids',399,0,18,K,'Pink','',1,1,'assets/img/products/ladubai.webp',KD],
['PV-KID-WOB','wheels-on-the-bus','Wheels On The Bus','kids',399,0,20,K,'Navy Blue','',0,1,'assets/img/products/wheels-on-the-bus.webp',KD],
['PV-KID-MBT','mazi-bat-mazi-batting','Mazi Bat Mazi Batting','kids',399,0,16,K,'Red','',1,1,'assets/img/products/mazi-bat-mazi-batting.webp',KD],
['PV-KID-BLP','babachi-ladki','Babachi Ladki','kids',399,0,22,K,'Pink','',0,1,'assets/img/products/babachi-ladki.webp',KD],
['PV-KID-BLR','babanchi-ladki','Babanchi Ladki','kids',399,0,14,K,'Red','',0,1,'assets/img/products/babanchi-ladki.webp',KD],
['PV-KID-GGL','i-dont-need-google',"I Don't Need Google",'kids',399,0,12,K,'Yellow','Trending',1,1,'assets/img/products/i-dont-need-google.webp',KD],
['PV-KID-TWB','twinning-with-brother','Twinning With Brother','kids',399,0,10,K,'White','',0,1,'assets/img/products/twinning-with-brother.webp',KD],
['PV-KID-PKP','pasara-karnyat-patait','Pasara Karnyat Patait','kids',399,0,15,K,'Sky Blue','',0,1,'assets/img/products/pasara-karnyat-patait.webp',KD],
['PV-KID-GDA','gondas-aagau','Gondas Aagau','kids',399,0,19,K,'Navy Blue','',0,1,'assets/img/products/gondas-aagau.webp',KD],
['PV-KID-AAL','aaicha-ladoba','Aaicha Ladoba','kids',399,0,26,K,'Red','Bestseller',1,1,'assets/img/products/aaicha-ladoba.webp',KD],
['PV-KID-BCC','babachi-carbon-copy','Babachi Carbon Copy','kids',399,0,17,K,'Red','',0,1,'assets/img/products/babachi-carbon-copy.webp',KD],
['PV-KID-SKP','sakharech-pote','Sakharech Pote','kids',350,0,21,K,'Black','',0,1,'assets/img/products/sakharech-pote.webp',KD],
['PV-KID-HNM','hanumaan','Hanumaan','kids',370,0,13,K,'Orange','',1,1,'assets/img/products/hanumaan.webp',KD],
['PV-KID-ACC','aaichi-carbon-copy','Aaichi Carbon Copy','kids',399,0,20,K,'Yellow','New',1,1,'assets/img/products/aaichi-carbon-copy.webp',KD],
['PV-MEN-EKS','ekante-sukhmasyatam','Ekante Sukhmasyatam','men',450,0,14,M,'Black','',1,1,'assets/img/products/ekante-sukhmasyatam.webp',MD],
['PV-MEN-FTP','fukat-te-poshtik','Fukat Te Poshtik','men',450,0,16,M,'White','Trending',1,1,'assets/img/products/fukat-te-poshtik.webp',MD],
['PV-MEN-DPA','daughter-and-papa','Daughter and PAPA','men',450,0,12,M,'Navy Blue','Bestseller',1,1,'assets/img/products/daughter-and-papa.webp',MD],
['PV-WMN-AMK','allergic-to-morning','Allergic To Morning','women',450,0,15,W,'Kiwi Green','',1,1,'assets/img/products/allergic-to-morning.webp',WD],
['PV-WMN-CKR','chakra','Chakra','women',450,0,11,W,'Violet','New',1,1,'assets/img/products/chakra.webp',WD],
['PV-WMN-AML','allergic-to-morning-lavender','Allergic To Morning Lavender','women',450,0,18,W,'Lavender','Bestseller',1,1,'assets/img/products/allergic-to-morning-lavender.webp',WD],
['PV-TOT-CHF','chafa','Chafa','tote',350,0,30,'One Size','Off White','',1,1,'assets/img/products/chafa.webp',TD],
['PV-TOT-JSW','jastwand','Jastwand','tote',350,0,28,'One Size','Off White','',0,1,'assets/img/products/jastwand.webp',TD],
['PV-TOT-NGD','nishigandh','Nishigandh','tote',300,0,25,'One Size','Off White','',0,1,'assets/img/products/nishigandh.webp',TD],
['PV-TOT-BRN','bharatnatyam','Bharatnatyam','tote',350,0,22,'One Size','Off White','Trending',1,1,'assets/img/products/bharatnatyam.webp',TD],
['PV-TOT-KTH','kathak','Kathak','tote',350,0,24,'One Size','Off White','',1,1,'assets/img/products/kathak.webp',TD],
['PV-TOT-PRJ','prajakta','Prajakta','tote',350,0,26,'One Size','Off White','',0,1,'assets/img/products/prajakta.webp',TD],
['PV-TOT-TLP','tulips','Tulips','tote',300,0,27,'One Size','Off White','Bestseller',1,1,'assets/img/products/tulips.webp',TD],
['PV-YOG-KPC','keep-calm','Keep Calm','yoga',450,0,14,W,'White','New',1,1,'assets/img/products/keep-calm.webp',
  'Breathable, easy-moving cotton with a calm, minimal print. Made for the mat and everything after it.'],
['PV-INF-CRW','cute-romper','Cute Romper','infant',250,0,20,I,'White','',1,1,'assets/img/products/cute-romper.webp',
  'Ultra-soft skin-friendly cotton romper with easy press-button closure — gentle on newborn skin, easy on parents.'],
['PV-INF-CRP','cute-romper-pink','Cute Romper Pink','infant',300,0,18,I,'Pink','',1,1,'assets/img/products/cute-romper-pink.webp',
  'Ultra-soft skin-friendly cotton romper with easy press-button closure — gentle on newborn skin, easy on parents.']
];
