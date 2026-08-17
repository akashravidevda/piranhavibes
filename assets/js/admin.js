/* =============================================================
   PIRANHA VIBES — Admin console
   Talks to the Google Apps Script backend. Every write is
   authenticated with the admin key stored in Script Properties.
   ============================================================= */
(function () {
  "use strict";
  const { $, $$, esc, money, Store, send, jsonp, toast, read, write, LS, CFG, catMeta, slugify } =
    window.PV;

  const STATUSES = ["New", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled"];
  let KEY = read(LS.adminKey, "") || sessionStorage.getItem("pv_admin_key") || "";
  let DATA = { orders: [], products: [], coupons: [], settings: {}, contacts: [] };
  let live = false;
  let STORAGE = null; // { backend: 'github' | 'drive', repo, branch, dir }

  /* ---------------------------------------------------------
     Image pipeline
     Shrinks and re-encodes in the browser before upload, so the
     repo stays small and the request always fits in one POST.
     The GitHub token lives only in Apps Script Script Properties
     — it is never shipped to this page.
     --------------------------------------------------------- */
  const MAX_EDGE = 1200;
  const MAX_UPLOAD_KB = 900;

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error("That file isn't an image"));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        const ctx = cv.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, cv.width, cv.height);

        // WebP where supported (much smaller), JPEG otherwise.
        let mime = "image/webp";
        let data = cv.toDataURL(mime, 0.86);
        if (data.indexOf("data:image/webp") !== 0) {
          mime = "image/jpeg";
          data = cv.toDataURL(mime, 0.86);
        }
        // Step the quality down if it is still heavy.
        let q = 0.86;
        while (data.length * 0.75 > MAX_UPLOAD_KB * 1024 && q > 0.45) {
          q -= 0.12;
          data = cv.toDataURL(mime, q);
        }
        resolve({
          base64: data.split(",")[1],
          mime,
          ext: mime === "image/webp" ? "webp" : "jpg",
          dataUrl: data,
          kb: Math.round((data.length * 0.75) / 1024),
          w: cv.width,
          h: cv.height,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that image"));
      };
      img.src = url;
    });
  }

  /* ---------------------------------------------------------
     Auth
     --------------------------------------------------------- */
  /* ---------------------------------------------------------
     Backend connection
     --------------------------------------------------------- */
  const API_OVERRIDE = "pv_api_url";

  function connectLine(url) {
    return '  API_URL: "' + url + '",';
  }

  async function verifyEndpoint(url) {
    // catalog() is public, so this proves the deployment is reachable
    // and shared correctly — before we commit to saving it.
    const r = await jsonp({ action: "catalog" }, 20000, url);
    if (!r || !r.ok) throw new Error("BAD_RESPONSE");
    return r;
  }

  function noticeBox(title, bodyHtml) {
    $("#loginHint").innerHTML = `
<div style="text-align:left;padding:16px;border-radius:12px;background:#fffbf0;border:1px solid var(--gold);color:var(--tx)">
  <b style="display:block;margin-bottom:8px;font-size:.9rem">${title}</b>
  ${bodyHtml}
</div>`;
  }

  /* The deployment is running an older Code.gs than this site expects. */
  function showStaleDeployment() {
    noticeBox(
      "Your Apps Script deployment is out of date",
      `<p style="font-size:.8rem;line-height:1.65;margin-bottom:10px">
        The backend is reachable, but it's running an older version of
        <code>Code.gs</code>. Saving the file isn't enough — Apps Script keeps
        serving the last <i>deployed</i> version until you publish a new one.
      </p>
      <p style="font-size:.8rem;line-height:1.7;margin-bottom:4px"><b>Fix it:</b></p>
      <ol style="font-size:.8rem;line-height:1.75;padding-left:18px;list-style:decimal">
        <li>Paste the latest <code>google-apps-script/Code.gs</code> over your script and save</li>
        <li>Run <code>setup</code> once and approve any new permission</li>
        <li><b>Deploy ▸ Manage deployments ▸ pencil icon</b></li>
        <li>Version: <b>New version</b> ▸ <b>Deploy</b></li>
      </ol>
      <p style="font-size:.8rem;margin-top:10px">The URL stays the same.
        <button id="retryHealth" style="text-decoration:underline;font-weight:600">Check again</button>
      </p>`
    );
    wireRetry();
  }

  /* The backend answered, but it has no ADMIN_KEY — so no password can
     ever work. Say that outright instead of "incorrect key". */
  function showSetupNeeded() {
    noticeBox(
      "No admin password is set on the backend yet",
      `<p style="font-size:.8rem;line-height:1.65;margin-bottom:10px">
        The connection is fine — your Google Sheet is reachable. But
        <code>ADMIN_KEY</code> is missing in Apps Script, so every password is
        refused. Nothing is exposed: the panel is locked, not open.
      </p>
      <p style="font-size:.8rem;line-height:1.7;margin-bottom:4px"><b>Fix it in 30 seconds:</b></p>
      <ol style="font-size:.8rem;line-height:1.75;padding-left:18px;list-style:decimal">
        <li>Open your Apps Script project</li>
        <li><b>Project Settings</b> (gear icon in the left rail)</li>
        <li>Scroll to <b>Script Properties ▸ Add script property</b></li>
        <li>Name <code>ADMIN_KEY</code>, Value = the password you want</li>
        <li><b>Save script properties</b> — no redeploy needed</li>
      </ol>
      <p style="font-size:.8rem;margin-top:10px">Then come back and sign in.
        <button id="retryHealth" style="text-decoration:underline;font-weight:600">Check again</button>
      </p>`
    );
    wireRetry();
  }

  function wireRetry() {
    const rb = $("#retryHealth");
    if (!rb) return;
    rb.onclick = async () => {
      const original = rb.textContent;
      rb.textContent = "Checking…";
      try {
        const h = await jsonp({ action: "health" }, 15000);
        if (h && h.adminKeySet) {
          $("#loginHint").innerHTML =
            '<b style="color:var(--green)">All set — sign in above.</b>';
          $("#key").closest(".field").classList.remove("err");
          sessionStorage.removeItem(LOCK);
          $("#key").focus();
          return;
        }
      } catch (e) {}
      rb.textContent = "Not ready yet — " + original.toLowerCase();
    };
  }

  function wireConnect() {
    const box = $("#connectBox");
    if (!box) return;
    box.classList.remove("hidden");
    $("#loginHint").innerHTML =
      "<b>Backend not connected yet.</b> Connect it below, or sign in with any key to preview the console on the local seed catalogue.";

    const input = $("#apiUrl");
    const msg = $("#apiMsg");
    const btn = $("#connectBtn");
    const fail = (t) => {
      msg.textContent = t;
      input.closest(".field").classList.add("err");
    };
    input.addEventListener("input", () =>
      input.closest(".field").classList.remove("err")
    );

    btn.onclick = async () => {
      const url = input.value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.test(url)) {
        return fail(
          /\/dev(\?|$)/.test(url)
            ? "That's the test URL. Use Deploy ▸ Manage deployments and copy the Web app URL ending in /exec."
            : "Paste the full Web app URL, ending in /exec."
        );
      }
      btn.classList.add("btn-loading");
      try {
        const cat = await verifyEndpoint(url);
        localStorage.setItem(API_OVERRIDE, url);
        localStorage.removeItem(LS.cache);
        toast(`Connected — ${(cat.products || []).length} products found`);
        setTimeout(() => location.reload(), 700);
      } catch (e) {
        btn.classList.remove("btn-loading");
        fail(
          "Couldn't reach that deployment. Check that Deploy ▸ Web app has " +
            'Execute as "Me" and Who has access "Anyone", then redeploy a new version.'
        );
      }
    };
  }

  if (!CFG.API_URL) wireConnect();

  /* --- login hardening: reveal toggle, caps-lock hint, lockout --- */
  const LOCK = "pv_admin_lock_v1";
  const MAX_TRIES = 5;
  const LOCK_MS = 60000;

  function lockState() {
    try {
      return JSON.parse(sessionStorage.getItem(LOCK) || '{"fails":0,"until":0}');
    } catch (e) {
      return { fails: 0, until: 0 };
    }
  }
  function setLock(s) {
    sessionStorage.setItem(LOCK, JSON.stringify(s));
  }
  function failMsg(text) {
    $("#keyMsg").textContent = text;
    $("#key").closest(".field").classList.add("err");
  }
  function clearFail() {
    $("#key").closest(".field").classList.remove("err");
    $("#loginAlt").classList.add("hidden");
  }

  const pwToggle = $("#pwToggle");
  if (pwToggle)
    pwToggle.onclick = () => {
      const inp = $("#key");
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      pwToggle.classList.toggle("on", show);
      pwToggle.setAttribute("aria-pressed", String(show));
      pwToggle.setAttribute("aria-label", show ? "Hide admin key" : "Show admin key");
      inp.focus();
    };

  const keyInput = $("#key");
  if (keyInput) {
    keyInput.addEventListener("keyup", (e) => {
      const caps = e.getModifierState && e.getModifierState("CapsLock");
      $("#capsWarn").classList.toggle("hidden", !caps);
    });
    keyInput.addEventListener("input", clearFail);
  }

  const offlineBtn = $("#offlineBtn");
  if (offlineBtn)
    offlineBtn.onclick = () => {
      KEY = $("#key").value.trim();
      sessionStorage.setItem("pv_admin_key", KEY);
      enter();
    };

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const k = $("#key").value.trim();
    if (!k) return failMsg("Enter your admin key");

    const st = lockState();
    if (st.until > Date.now()) {
      const secs = Math.ceil((st.until - Date.now()) / 1000);
      return failMsg(`Too many attempts. Try again in ${secs}s.`);
    }

    const btn = $("#loginBtn");
    btn.classList.add("btn-loading");
    clearFail();

    // No backend configured at all → this is a local preview of the console.
    if (!CFG.API_URL) {
      btn.classList.remove("btn-loading");
      KEY = k;
      sessionStorage.setItem("pv_admin_key", k);
      return enter();
    }

    let verdict = "error";
    try {
      const r = await jsonp({ action: "adminPing", key: k });
      verdict = r && r.ok ? "ok" : "bad";
    } catch (err) {
      verdict = "error";
    }
    btn.classList.remove("btn-loading");

    if (verdict === "ok") {
      setLock({ fails: 0, until: 0 });
      KEY = k;
      // Only persist across browser restarts if explicitly asked.
      if ($("#remember").checked) write(LS.adminKey, k);
      else sessionStorage.setItem("pv_admin_key", k);
      return enter();
    }

    if (verdict === "bad") {
      // "Rejected" can mean the wrong key OR that no key was ever configured
      // on the backend. Those need completely different fixes, so find out.
      let h = null;
      try {
        h = await jsonp({ action: "health" }, 15000);
      } catch (e) {}

      if (h && h.ok && h.adminKeySet === false) {
        $("#key").closest(".field").classList.add("err");
        $("#keyMsg").textContent = "";
        return showSetupNeeded();
      }
      // An older Code.gs has no `health` action, so the request falls through
      // to the service banner — which has no adminKeySet field at all.
      if (h && h.ok && typeof h.adminKeySet === "undefined") {
        $("#key").closest(".field").classList.add("err");
        $("#keyMsg").textContent = "";
        return showStaleDeployment();
      }

      const fails = st.fails + 1;
      const locked = fails >= MAX_TRIES;
      setLock({ fails: locked ? 0 : fails, until: locked ? Date.now() + LOCK_MS : 0 });
      return failMsg(
        locked
          ? "Too many attempts. Locked for 60 seconds."
          : `Incorrect key — ${MAX_TRIES - fails} attempt${
              MAX_TRIES - fails === 1 ? "" : "s"
            } left.`
      );
    }

    // Network problem: never silently wave anyone through — make it a choice.
    failMsg("Couldn't verify the key right now.");
    $("#loginAlt").classList.remove("hidden");
  });

  /* --- auto sign-out after 30 minutes of inactivity --- */
  const IDLE_MS = 30 * 60000;
  let idleTimer = null;
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      sessionStorage.removeItem("pv_admin_key");
      write(LS.adminKey, "");
      alert("Signed out after 30 minutes of inactivity.");
      location.reload();
    }, IDLE_MS);
  }

  $("#logoutBtn") &&
    ($("#logoutBtn").onclick = () => {
      write(LS.adminKey, "");
      sessionStorage.removeItem("pv_admin_key");
      location.reload();
    });

  if (KEY) enter();

  async function enter() {
    $("#login").classList.add("hidden");
    $("#shell").classList.remove("hidden");
    ["click", "keydown", "mousemove", "touchstart"].forEach((ev) =>
      document.addEventListener(ev, armIdle, { passive: true })
    );
    armIdle();
    await refresh();
  }

  /* ---------------------------------------------------------
     Data
     --------------------------------------------------------- */
  async function refresh() {
    await Store.ready;
    DATA.products = Store.products.slice();
    DATA.coupons = (Store.coupons || []).slice();
    DATA.settings = Object.assign({}, Store.settings);
    DATA.orders = [];
    live = false;

    if (CFG.API_URL) {
      try {
        const r = await jsonp({ action: "adminData", key: KEY }, 25000);
        if (r && r.ok) {
          DATA.orders = r.orders || [];
          DATA.products = (r.products || DATA.products).map(window.PV.normalise);
          DATA.coupons = r.coupons || DATA.coupons;
          DATA.settings = Object.assign(DATA.settings, r.settings || {});
          DATA.contacts = r.contacts || [];
          live = true;
        }
      } catch (e) {}
      try {
        const s = await jsonp({ action: "storageStatus", key: KEY });
        if (s && s.ok) STORAGE = s;
      } catch (e) {}
    }
    if (!live) {
      // offline preview: show orders captured on this device
      DATA.orders = read(LS.orders, []).map((o) => ({
        id: o.id,
        createdAt: o.at,
        customer: o.customer || "",
        phone: o.phone || "",
        email: "",
        city: "",
        total: o.total,
        itemCount: (o.items || []).reduce((s, i) => s + i.qty, 0),
        status: o.status || "New",
        paymentMethod: "",
        items: o.items || [],
      }));
    }
    $("#offlineNote").innerHTML = live
      ? ""
      : `<div class="card" style="border-color:var(--gold);background:#fffbf0;margin-bottom:20px;padding:16px 20px">
          <b>Offline preview.</b> <span class="muted">Not connected to Google Sheets — showing the local seed catalogue and any orders placed on this device.
          Follow <code>SETUP.md</code> and paste your Apps Script URL into <code>assets/js/config.js</code> to go live.</span>
        </div>`;
    renderAll();
  }
  $("#refreshBtn").onclick = async () => {
    write(LS.cache, null);
    await window.PV.loadCatalog(true);
    await refresh();
    toast("Data refreshed");
  };

  async function api(action, payload) {
    if (!live) {
      toast("Connect the Google Sheets backend to save changes.", "err");
      return { ok: false };
    }
    const r = await send(action, Object.assign({ key: KEY }, payload));
    if (!r || !r.ok) toast((r && r.error) || "Save failed", "err");
    return r || { ok: false };
  }

  /* ---------------------------------------------------------
     Tabs
     --------------------------------------------------------- */
  $$(".nv[data-tab]").forEach((b) => {
    b.onclick = () => {
      $$(".nv[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
      ["dash", "orders", "products", "coupons", "settings"].forEach((t) =>
        $("#tab-" + t).classList.toggle("hidden", t !== b.dataset.tab)
      );
    };
  });

  function renderAll() {
    renderDash();
    renderOrders();
    renderProducts();
    renderCoupons();
    renderSettings();
    const n = DATA.orders.filter((o) => o.status === "New").length;
    $("#navNew").textContent = n || "";
    $("#navNew").style.display = n ? "" : "none";
  }

  /* ---------------------------------------------------------
     Dashboard
     --------------------------------------------------------- */
  function renderDash() {
    const os = DATA.orders.filter((o) => o.status !== "Cancelled");
    const rev = os.reduce((s, o) => s + Number(o.total || 0), 0);
    const units = os.reduce((s, o) => s + Number(o.itemCount || 0), 0);
    const aov = os.length ? Math.round(rev / os.length) : 0;
    const today = new Date().toDateString();
    const todayOrders = os.filter(
      (o) => new Date(o.createdAt).toDateString() === today
    );
    const pending = DATA.orders.filter((o) =>
      ["New", "Confirmed", "Packed"].includes(o.status)
    ).length;
    const lowStock = DATA.products.filter((p) => p.active && p.stock <= CFG.LOW_STOCK_THRESHOLD);
    const outStock = DATA.products.filter((p) => p.active && p.stock <= 0);

    // top sellers by qty across all order items
    const tally = {};
    DATA.orders.forEach((o) =>
      (o.items || []).forEach((i) => {
        tally[i.name] = (tally[i.name] || 0) + Number(i.qty || 0);
      })
    );
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxTop = top.length ? top[0][1] : 1;

    // last 14 days revenue
    const days = [];
    for (let d = 13; d >= 0; d--) {
      const dt = new Date(Date.now() - d * 864e5);
      const key = dt.toDateString();
      days.push({
        label: dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        v: os
          .filter((o) => new Date(o.createdAt).toDateString() === key)
          .reduce((s, o) => s + Number(o.total || 0), 0),
      });
    }
    const maxDay = Math.max(1, ...days.map((d) => d.v));

    $("#tab-dash").innerHTML = `
<div class="adm-hd">
  <div><h1 class="d3">Dashboard</h1>
    <p class="muted tiny">${live ? "Live from Google Sheets" : "Local preview"} · ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p></div>
  <a class="btn btn-sm btn-ghost" href="index.html" target="_blank">View storefront ↗</a>
</div>

<div class="kpis">
  <div class="kpi"><div class="l">Total revenue</div><div class="v">${money(rev)}</div><div class="d">${os.length} paid orders</div></div>
  <div class="kpi"><div class="l">Orders today</div><div class="v">${todayOrders.length}</div><div class="d">${money(todayOrders.reduce((s, o) => s + Number(o.total || 0), 0))} today</div></div>
  <div class="kpi"><div class="l">Pending fulfilment</div><div class="v">${pending}</div><div class="d" style="color:${pending ? "var(--red)" : "var(--green)"}">${pending ? "Needs action" : "All clear"}</div></div>
  <div class="kpi"><div class="l">Average order</div><div class="v">${money(aov)}</div><div class="d">${units} units sold</div></div>
  <div class="kpi"><div class="l">Live products</div><div class="v">${DATA.products.filter((p) => p.active).length}</div><div class="d" style="color:${outStock.length ? "var(--red)" : "var(--green)"}">${outStock.length} sold out</div></div>
</div>

<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;align-items:start" class="dash-split">
  <div class="card">
    <h3 style="font-size:1.05rem;margin-bottom:4px">Revenue · last 14 days</h3>
    <p class="tiny muted" style="margin-bottom:18px">Peak day ${money(maxDay)}</p>
    <div style="display:flex;align-items:flex-end;gap:6px;height:170px">
      ${days
        .map(
          (d) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px" title="${d.label}: ${money(d.v)}">
            <div style="width:100%;border-radius:6px 6px 0 0;background:${d.v ? "linear-gradient(180deg,var(--navy),var(--red))" : "var(--sand)"};height:${Math.max(3, (d.v / maxDay) * 140)}px;transition:height .6s var(--e-out)"></div>
            <span style="font-size:.6rem;color:var(--tx-3);writing-mode:vertical-rl;transform:rotate(180deg)">${d.label}</span>
          </div>`
        )
        .join("")}
    </div>
  </div>

  <div class="card">
    <h3 style="font-size:1.05rem;margin-bottom:16px">Top sellers</h3>
    ${
      top.length
        ? top
            .map(
              (t) => `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:5px"><span>${esc(t[0])}</span><b>${t[1]}</b></div>
        <div style="height:6px;background:var(--sand);border-radius:100px;overflow:hidden"><div style="height:100%;width:${(t[1] / maxTop) * 100}%;background:var(--navy);border-radius:100px"></div></div>
      </div>`
            )
            .join("")
        : `<p class="muted tiny">No orders yet — top sellers will appear here.</p>`
    }
  </div>
</div>

<div class="card" style="margin-top:16px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap">
    <h3 style="font-size:1.05rem">Low stock alerts</h3>
    <button class="btn btn-sm btn-ghost" data-goto="products">Manage stock</button>
  </div>
  ${
    lowStock.length
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${lowStock
          .map(
            (p) =>
              `<span class="pill ${p.stock <= 0 ? "cancelled" : "packed"}">${esc(p.name)} · ${p.stock}</span>`
          )
          .join("")}</div>`
      : `<p class="muted tiny">Every product is comfortably stocked.</p>`
  }
</div>

<div class="card" style="margin-top:16px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap">
    <h3 style="font-size:1.05rem">Latest orders</h3>
    <button class="btn btn-sm btn-ghost" data-goto="orders">All orders</button>
  </div>
  ${
    DATA.orders.length
      ? `<div class="tbl-wrap" style="border:0"><table>
      <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${DATA.orders
        .slice(0, 6)
        .map(
          (o) => `<tr><td style="font-family:var(--mono)">${esc(o.id)}</td>
        <td>${esc(o.customer)}</td><td>${o.itemCount}</td><td>${money(o.total)}</td>
        <td><span class="pill ${String(o.status).toLowerCase()}">${esc(o.status)}</span></td></tr>`
        )
        .join("")}</tbody></table></div>`
      : `<p class="muted tiny">No orders yet.</p>`
  }
</div>`;

    $$("[data-goto]").forEach(
      (b) => (b.onclick = () => $(`.nv[data-tab="${b.dataset.goto}"]`).click())
    );
  }

  /* ---------------------------------------------------------
     Orders
     --------------------------------------------------------- */
  let oFilter = "All",
    oQuery = "";

  function renderOrders() {
    let list = DATA.orders.slice();
    if (oFilter !== "All") list = list.filter((o) => o.status === oFilter);
    if (oQuery) {
      const q = oQuery.toLowerCase();
      list = list.filter(
        (o) =>
          String(o.id).toLowerCase().includes(q) ||
          String(o.customer).toLowerCase().includes(q) ||
          String(o.phone).includes(q) ||
          String(o.city).toLowerCase().includes(q)
      );
    }

    $("#tab-orders").innerHTML = `
<div class="adm-hd">
  <div><h1 class="d3">Orders</h1><p class="muted tiny">${list.length} shown · ${DATA.orders.length} total</p></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <input class="sel" id="oSearch" placeholder="Search ID, name, phone…" value="${esc(oQuery)}" style="min-width:200px">
    <button class="btn btn-sm btn-ghost" id="exportOrders">Export CSV</button>
  </div>
</div>

<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px">
  ${["All"].concat(STATUSES)
    .map((s) => {
      const n = s === "All" ? DATA.orders.length : DATA.orders.filter((o) => o.status === s).length;
      return `<button class="chip${oFilter === s ? " on" : ""}" data-of="${s}" style="min-width:auto;padding:8px 14px;font-size:.82rem">${s} <span style="opacity:.6">${n}</span></button>`;
    })
    .join("")}
</div>

<div class="tbl-wrap">
  <table>
    <thead><tr>
      <th>Order ID</th><th>Date</th><th>Customer</th><th>Contact</th><th>Ship to</th>
      <th>Items</th><th>Total</th><th>Pay</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>
      ${
        list.length
          ? list
              .map(
                (o) => `<tr>
        <td style="font-family:var(--mono);font-weight:600">${esc(o.id)}</td>
        <td class="tiny">${new Date(o.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
        <td>${esc(o.customer)}</td>
        <td class="tiny">${esc(o.phone)}<br><span class="muted">${esc(o.email || "")}</span></td>
        <td class="tiny">${esc(o.city || "")}${o.pincode ? " · " + esc(o.pincode) : ""}</td>
        <td>${o.itemCount}</td>
        <td style="font-weight:600">${money(o.total)}</td>
        <td class="tiny">${esc(o.paymentMethod || "—")}</td>
        <td>
          <select class="sel" data-status="${esc(o.id)}" style="padding:6px 10px;font-size:.8rem">
            ${STATUSES.map((s) => `<option${o.status === s ? " selected" : ""}>${s}</option>`).join("")}
          </select>
        </td>
        <td><button class="btn btn-sm btn-ghost" data-view="${esc(o.id)}">View</button></td>
      </tr>`
              )
              .join("")
          : `<tr><td colspan="10" style="text-align:center;padding:44px;color:var(--tx-3)">No orders match this view.</td></tr>`
      }
    </tbody>
  </table>
</div>`;

    $$("[data-of]").forEach(
      (b) =>
        (b.onclick = () => {
          oFilter = b.dataset.of;
          renderOrders();
        })
    );
    const s = $("#oSearch");
    s.oninput = () => {
      oQuery = s.value.trim();
      const pos = s.selectionStart;
      renderOrders();
      const ns = $("#oSearch");
      ns.focus();
      ns.setSelectionRange(pos, pos);
    };
    $("#exportOrders").onclick = exportOrders;

    $$("[data-status]").forEach((sel) => {
      sel.onchange = async () => {
        const id = sel.dataset.status;
        const r = await api("updateOrderStatus", { id, status: sel.value });
        const o = DATA.orders.find((x) => x.id === id);
        if (o) o.status = sel.value;
        if (r.ok) toast(`${id} → ${sel.value}`);
        renderDash();
      };
    });
    $$("[data-view]").forEach((b) => (b.onclick = () => viewOrder(b.dataset.view)));
  }

  function viewOrder(id) {
    const o = DATA.orders.find((x) => x.id === id);
    if (!o) return;
    const addr = [o.addr1, o.addr2, o.landmark && "Near " + o.landmark, `${o.city || ""} ${o.state || ""} ${o.pincode || ""}`]
      .filter(Boolean)
      .join("<br>");
    $("#modalBox").innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px">
  <div><span class="pc-cat">Order</span>
    <h2 class="d3" style="font-family:var(--mono);font-size:1.3rem;margin-top:4px">${esc(o.id)}</h2>
    <p class="tiny muted">${new Date(o.createdAt).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}</p></div>
  <button class="icon-btn" id="mClose" aria-label="Close" style="font-size:1.5rem">&times;</button>
</div>
<div class="grid2">
  <div><h5 style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--tx-3);margin-bottom:8px">Customer</h5>
    <p style="font-size:.92rem;line-height:1.7"><b>${esc(o.customer)}</b><br>${esc(o.phone)}<br>${esc(o.email || "")}</p></div>
  <div><h5 style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--tx-3);margin-bottom:8px">Ship to</h5>
    <p style="font-size:.92rem;line-height:1.7">${addr || "<span class='muted'>Not captured</span>"}</p></div>
</div>
<div style="border-top:1px solid var(--line);margin:18px 0 12px"></div>
<h5 style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--tx-3);margin-bottom:10px">Items</h5>
${(o.items || [])
  .map(
    (i) => `<div class="mini-item"><div style="flex:1"><b>${esc(i.name)}</b>
    <div class="tiny muted">${[i.size, i.color].filter(Boolean).join(" · ")} · ${esc(i.sku || "")} · Qty ${i.qty}</div></div>
    <div style="font-weight:600">${money(i.lineTotal || i.price * i.qty)}</div></div>`
  )
  .join("")}
<div class="sum-row" style="margin-top:12px"><span>Subtotal</span><span>${money(o.subtotal || o.total)}</span></div>
${o.discount ? `<div class="sum-row" style="color:var(--green)"><span>Discount ${esc(o.coupon || "")}</span><span>− ${money(o.discount)}</span></div>` : ""}
${o.shipping ? `<div class="sum-row"><span>Shipping</span><span>${money(o.shipping)}</span></div>` : ""}
<div class="sum-row total"><span>Total</span><span>${money(o.total)}</span></div>
<p class="tiny muted" style="margin-top:10px">Payment: <b>${esc(o.paymentMethod || "—")}</b>${o.txnRef ? " · UTR " + esc(o.txnRef) : ""}</p>
${o.notes ? `<div class="card" style="margin-top:14px;padding:14px;background:var(--paper-2)"><b class="tiny">Customer note</b><p style="font-size:.9rem;margin-top:5px">${esc(o.notes)}</p></div>` : ""}

<div class="grid2" style="margin-top:20px">
  <div class="field"><label for="mCourier">Courier</label><input id="mCourier" value="${esc(o.courier || "")}" placeholder="Delhivery, DTDC…"></div>
  <div class="field"><label for="mTrack">Tracking ID</label><input id="mTrack" value="${esc(o.trackingId || "")}" placeholder="Courier AWB"></div>
</div>
<div class="field"><label for="mAdminNote">Internal note</label><input id="mAdminNote" value="${esc(o.adminNote || "")}" placeholder="Visible only to your team"></div>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
  <button class="btn btn-sm" id="mSave">Save shipping details</button>
  <a class="btn btn-sm btn-ghost" target="_blank" rel="noopener"
     href="https://wa.me/91${esc(String(o.phone).slice(-10))}?text=${encodeURIComponent(
      `Hi ${o.customer}, this is Piranha Vibes. Update on your order ${o.id}: `
    )}">WhatsApp customer</a>
  <button class="btn btn-sm btn-ghost" id="mPrint">Print invoice</button>
</div>`;
    $("#modal").classList.add("on");
    $("#mClose").onclick = () => $("#modal").classList.remove("on");
    $("#mPrint").onclick = () => window.print();
    $("#mSave").onclick = async () => {
      const payload = {
        id: o.id,
        courier: $("#mCourier").value.trim(),
        trackingId: $("#mTrack").value.trim(),
        adminNote: $("#mAdminNote").value.trim(),
      };
      const r = await api("updateOrderMeta", payload);
      Object.assign(o, payload);
      if (r.ok) {
        toast("Shipping details saved");
        $("#modal").classList.remove("on");
      }
    };
  }
  $("#modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") $("#modal").classList.remove("on");
  });

  function csv(rows) {
    return rows
      .map((r) =>
        r
          .map((c) => {
            const v = c == null ? "" : String(c);
            return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
          })
          .join(",")
      )
      .join("\n");
  }
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportOrders() {
    const rows = [
      ["Order ID","Date","Customer","Phone","Email","Address","City","State","PIN","Items","Subtotal","Discount","Shipping","Total","Payment","UTR","Status","Courier","Tracking"],
    ];
    DATA.orders.forEach((o) =>
      rows.push([
        o.id, o.createdAt, o.customer, o.phone, o.email,
        [o.addr1, o.addr2].filter(Boolean).join(" "), o.city, o.state, o.pincode,
        (o.items || []).map((i) => `${i.name} (${i.size || "-"}) x${i.qty}`).join(" | "),
        o.subtotal, o.discount, o.shipping, o.total, o.paymentMethod, o.txnRef,
        o.status, o.courier, o.trackingId,
      ])
    );
    download(`piranha-orders-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows));
    toast("Orders exported");
  }

  /* ---------------------------------------------------------
     Products — pricing & stock
     --------------------------------------------------------- */
  let pQuery = "", pCat = "All";

  function renderProducts() {
    let list = DATA.products.slice();
    if (pCat !== "All") list = list.filter((p) => p.category === pCat);
    if (pQuery)
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(pQuery.toLowerCase()) ||
          p.sku.toLowerCase().includes(pQuery.toLowerCase())
      );

    $("#tab-products").innerHTML = `
<div class="adm-hd">
  <div><h1 class="d3">Products</h1><p class="muted tiny">Edit price, MRP and stock inline, then save. Changes write straight to your Google Sheet.</p></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <input class="sel" id="pSearch" placeholder="Search name or SKU" value="${esc(pQuery)}" style="min-width:190px">
    <button class="btn btn-sm btn-ghost" id="exportProducts">Export CSV</button>
    <button class="btn btn-sm" id="addProduct">+ New product</button>
  </div>
</div>

<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px">
  ${["All"].concat(Store.categories.map((c) => c.id))
    .map(
      (c) =>
        `<button class="chip${pCat === c ? " on" : ""}" data-pc="${c}" style="min-width:auto;padding:8px 14px;font-size:.82rem">${
          c === "All" ? "All" : esc(catMeta(c).name)
        }</button>`
    )
    .join("")}
</div>

<div id="saveBar" class="hidden" style="position:sticky;top:0;z-index:5;background:var(--ink);color:#fff;border-radius:12px;padding:12px 18px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
  <span id="dirtyCount" style="font-size:.88rem"></span>
  <div style="display:flex;gap:8px">
    <button class="btn btn-sm btn-light" id="saveProducts">Save changes</button>
    <button class="btn btn-sm btn-ghost" id="discardProducts" style="border-color:rgba(255,255,255,.4);color:#fff">Discard</button>
  </div>
</div>

<div class="tbl-wrap">
  <table>
    <thead><tr>
      <th style="width:52px"></th><th>Product</th><th>SKU</th><th>Category</th>
      <th>Price ₹</th><th>MRP ₹</th><th>Stock</th><th>Featured</th><th>Badge</th><th>Live</th><th></th>
    </tr></thead>
    <tbody>
      ${list
        .map(
          (p) => `<tr data-slug="${esc(p.slug)}">
        <td><img src="${esc(p.image)}" alt="" style="width:42px;height:50px;object-fit:cover;border-radius:7px;background:var(--sand)" onerror="this.style.opacity=.2"></td>
        <td><b>${esc(p.name)}</b><div class="tiny muted">${p.sizes.join(", ")}</div></td>
        <td class="tiny" style="font-family:var(--mono)">${esc(p.sku)}</td>
        <td class="tiny">${esc(catMeta(p.category).name)}</td>
        <td><input class="inp-mini" type="number" min="0" step="1" data-f="price" value="${p.price}"></td>
        <td><input class="inp-mini" type="number" min="0" step="1" data-f="mrp" value="${p.mrp || ""}" placeholder="—"></td>
        <td><input class="inp-mini" type="number" min="0" step="1" data-f="stock" value="${p.stock}" style="width:74px;${
            p.stock <= 0 ? "border-color:var(--red);color:var(--red)" : p.stock <= CFG.LOW_STOCK_THRESHOLD ? "border-color:var(--gold)" : ""
          }"></td>
        <td><input type="checkbox" data-f="featured" ${p.featured ? "checked" : ""} style="accent-color:var(--navy);width:17px;height:17px"></td>
        <td><input class="inp-mini" data-f="badge" value="${esc(p.badge)}" placeholder="—" style="width:96px"></td>
        <td><input type="checkbox" data-f="active" ${p.active ? "checked" : ""} style="accent-color:var(--green);width:17px;height:17px"></td>
        <td><button class="btn btn-sm btn-ghost" data-edit="${esc(p.slug)}">Edit</button></td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>
</div>`;

    $$("[data-pc]").forEach(
      (b) =>
        (b.onclick = () => {
          pCat = b.dataset.pc;
          renderProducts();
        })
    );
    const ps = $("#pSearch");
    ps.oninput = () => {
      pQuery = ps.value.trim();
      const pos = ps.selectionStart;
      renderProducts();
      const n = $("#pSearch");
      n.focus();
      n.setSelectionRange(pos, pos);
    };
    $("#exportProducts").onclick = () => {
      const rows = [["SKU","Slug","Name","Category","Price","MRP","Stock","Sizes","Colors","Badge","Featured","Active","Image","Description"]];
      DATA.products.forEach((p) =>
        rows.push([p.sku, p.slug, p.name, p.category, p.price, p.mrp, p.stock, p.sizes.join("|"), p.colors.join("|"), p.badge, p.featured, p.active, p.image, p.desc])
      );
      download(`piranha-products-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows));
      toast("Products exported");
    };
    $("#addProduct").onclick = () => editProduct(null);
    $$("[data-edit]").forEach((b) => (b.onclick = () => editProduct(b.dataset.edit)));

    /* dirty tracking */
    const tbody = $("#tab-products tbody");
    tbody.addEventListener("input", markDirty);
    tbody.addEventListener("change", markDirty);
    function markDirty(e) {
      const inp = e.target;
      if (!inp.dataset.f) return;
      inp.classList.add("dirty");
      const tr = inp.closest("tr");
      tr.dataset.dirty = "1";
      const n = $$("tr[data-dirty]", tbody).length;
      $("#saveBar").classList.toggle("hidden", !n);
      $("#dirtyCount").textContent = `${n} product${n === 1 ? "" : "s"} edited — unsaved`;
    }
    $("#discardProducts").onclick = () => renderProducts();
    $("#saveProducts").onclick = async () => {
      const rows = $$("tr[data-dirty]", tbody);
      const updates = rows.map((tr) => {
        const g = (f) => $(`[data-f="${f}"]`, tr);
        return {
          slug: tr.dataset.slug,
          price: Number(g("price").value) || 0,
          mrp: Number(g("mrp").value) || 0,
          stock: Number(g("stock").value) || 0,
          featured: g("featured").checked ? 1 : 0,
          badge: g("badge").value.trim(),
          active: g("active").checked ? 1 : 0,
        };
      });
      const btn = $("#saveProducts");
      btn.classList.add("btn-loading");
      const r = await api("updateProducts", { updates });
      btn.classList.remove("btn-loading");
      updates.forEach((u) => {
        const p = DATA.products.find((x) => x.slug === u.slug);
        if (p) Object.assign(p, u);
      });
      if (r.ok) {
        write(LS.cache, null);
        toast(`${updates.length} product${updates.length === 1 ? "" : "s"} updated`);
      }
      renderProducts();
      renderDash();
    };
  }

  function editProduct(slug) {
    const p =
      DATA.products.find((x) => x.slug === slug) || {
        sku: "", slug: "", name: "", category: "kids", price: 0, mrp: 0,
        stock: 0, sizes: [], colors: [], desc: "", badge: "", featured: 0,
        active: 1, image: "",
      };
    const isNew = !slug;
    $("#modalBox").innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
  <h2 class="d3" style="font-size:1.3rem">${isNew ? "New product" : "Edit product"}</h2>
  <button class="icon-btn" id="mClose" style="font-size:1.5rem">&times;</button>
</div>
<div class="grid2">
  <div class="field"><label>Name *</label><input id="e-name" value="${esc(p.name)}"></div>
  <div class="field"><label>SKU</label><input id="e-sku" value="${esc(p.sku)}" placeholder="PV-KID-XXX"></div>
</div>
<div class="grid2">
  <div class="field"><label>Category</label><select id="e-cat">${Store.categories
    .map((c) => `<option value="${c.id}"${p.category === c.id ? " selected" : ""}>${esc(c.name)}</option>`)
    .join("")}</select></div>
  <div class="field"><label>Slug (URL)</label><input id="e-slug" value="${esc(p.slug)}" ${isNew ? "" : "readonly"} placeholder="auto from name"></div>
</div>
<div class="grid2">
  <div class="field"><label>Price ₹ *</label><input id="e-price" type="number" min="0" value="${p.price}"></div>
  <div class="field"><label>MRP ₹ (strike-through)</label><input id="e-mrp" type="number" min="0" value="${p.mrp || ""}"></div>
</div>
<div class="grid2">
  <div class="field"><label>Stock</label><input id="e-stock" type="number" min="0" value="${p.stock}"></div>
  <div class="field"><label>Badge</label><input id="e-badge" value="${esc(p.badge)}" placeholder="New / Bestseller / Trending"></div>
</div>
<div class="grid2">
  <div class="field"><label>Sizes (comma separated)</label><input id="e-sizes" value="${esc(p.sizes.join(", "))}" placeholder="S, M, L, XL"></div>
  <div class="field"><label>Colours (comma separated)</label><input id="e-colors" value="${esc(p.colors.join(", "))}" placeholder="Red, Navy Blue"></div>
</div>
<div class="field" style="margin-bottom:10px">
  <label>Product image</label>
  <div class="up-zone" id="upZone" tabindex="0" role="button" aria-label="Choose or drop a product image">
    <div class="up-thumb" id="upThumb">${
      p.image
        ? `<img src="${esc(p.image)}" alt="" onerror="this.style.display='none'">`
        : `<span class="up-ph">No image</span>`
    }</div>
    <div class="up-copy">
      <b id="upTitle">Drop an image here, or click to choose</b>
      <small id="upHint">Resized to 1200px and converted to WebP automatically${
        STORAGE
          ? STORAGE.backend === "github"
            ? ` · commits to <b>${esc(STORAGE.repo)}</b> (${esc(STORAGE.dir)})`
            : " · saved to your Google Drive"
          : ""
      }</small>
    </div>
    <input type="file" id="upFile" accept="image/*" hidden>
  </div>
  <div class="up-bar hidden" id="upBar"><span></span></div>
</div>
<div class="field"><label>Image path or URL <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">— filled in automatically after upload</span></label>
  <input id="e-image" value="${esc(p.image)}" placeholder="assets/img/products/my-design.webp"></div>
<div class="field"><label>Description</label><textarea id="e-desc" rows="4">${esc(p.desc)}</textarea></div>
<div style="display:flex;gap:18px;margin-bottom:18px">
  <label class="fopt"><input type="checkbox" id="e-featured" ${p.featured ? "checked" : ""}> Featured on homepage</label>
  <label class="fopt"><input type="checkbox" id="e-active" ${p.active ? "checked" : ""}> Visible on the store</label>
</div>
<div style="display:flex;gap:10px;flex-wrap:wrap">
  <button class="btn" id="e-save">${isNew ? "Create product" : "Save changes"}</button>
  ${isNew ? "" : `<button class="btn btn-ghost" id="e-del" style="border-color:var(--red);color:var(--red)">Delete</button>`}
</div>`;
    $("#modal").classList.add("on");
    $("#mClose").onclick = () => $("#modal").classList.remove("on");
    wireUpload(p);

    $("#e-save").onclick = async () => {
      const name = $("#e-name").value.trim();
      if (!name) return toast("Name is required", "err");
      const rec = {
        sku: $("#e-sku").value.trim() || "PV-" + slugify(name).toUpperCase().slice(0, 10),
        slug: ($("#e-slug").value.trim() || slugify(name)),
        name,
        category: $("#e-cat").value,
        price: Number($("#e-price").value) || 0,
        mrp: Number($("#e-mrp").value) || 0,
        stock: Number($("#e-stock").value) || 0,
        sizes: $("#e-sizes").value.split(",").map((s) => s.trim()).filter(Boolean).join("|"),
        colors: $("#e-colors").value.split(",").map((s) => s.trim()).filter(Boolean).join("|"),
        badge: $("#e-badge").value.trim(),
        featured: $("#e-featured").checked ? 1 : 0,
        active: $("#e-active").checked ? 1 : 0,
        image: $("#e-image").value.trim(),
        desc: $("#e-desc").value.trim(),
      };
      const btn = $("#e-save");
      btn.classList.add("btn-loading");
      const r = await api(isNew ? "createProduct" : "updateProduct", rec);
      btn.classList.remove("btn-loading");
      if (r.ok) {
        write(LS.cache, null);
        toast(isNew ? "Product created" : "Product saved");
        $("#modal").classList.remove("on");
        await refresh();
      }
    };
    const del = $("#e-del");
    if (del)
      del.onclick = async () => {
        if (!confirm(`Delete “${p.name}” permanently? Consider unticking “Visible on the store” instead.`)) return;
        const r = await api("deleteProduct", { slug: p.slug });
        if (r.ok) {
          write(LS.cache, null);
          toast("Product deleted");
          $("#modal").classList.remove("on");
          await refresh();
        }
      };
  }

  /* ---------------------------------------------------------
     Upload widget wiring
     --------------------------------------------------------- */
  /* Image uploads are POST-only: the JSONP fallback in PV.send
     puts the payload in a URL, which base64 image data would
     blow straight past. */
  async function postUpload(payload) {
    const r = await fetch(CFG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "uploadImage", payload }),
      redirect: "follow",
    });
    return JSON.parse(await r.text());
  }

  function wireUpload(p) {
    const zone = $("#upZone");
    if (!zone) return;
    const file = $("#upFile");
    const bar = $("#upBar");
    const title = $("#upTitle");
    const hint = $("#upHint");

    zone.onclick = () => file.click();
    zone.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        file.click();
      }
    };
    ["dragenter", "dragover"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add("drag");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove("drag");
      })
    );
    zone.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handle(f);
    });
    file.onchange = () => file.files[0] && handle(file.files[0]);

    async function handle(f) {
      let img;
      try {
        img = await compressImage(f);
      } catch (err) {
        return toast(err.message, "err");
      }

      // Instant local preview, whatever happens next.
      $("#upThumb").innerHTML = `<img src="${img.dataUrl}" alt="">`;
      hint.innerHTML = `${img.w}×${img.h} · ${img.kb} KB · ${img.ext.toUpperCase()}`;

      if (!live || !CFG.API_URL) {
        title.textContent = "Preview only — backend not connected";
        toast("Connect the Google Sheets backend to upload images.", "err");
        return;
      }

      const slug = slugify($("#e-slug").value.trim() || $("#e-name").value.trim() || "product");
      const filename = slug + "." + img.ext;

      zone.classList.add("busy");
      bar.classList.remove("hidden");
      title.textContent = "Uploading…";

      let res;
      try {
        res = await postUpload({
          key: KEY,
          filename,
          base64: img.base64,
          mime: img.mime,
        });
      } catch (err) {
        res = { ok: false, error: "Upload request failed — check your connection." };
      }

      zone.classList.remove("busy");
      bar.classList.add("hidden");

      if (!res || !res.ok) {
        title.textContent = "Upload failed — pick a file to retry";
        return toast((res && res.error) || "Upload failed", "err");
      }

      $("#e-image").value = res.url;
      title.innerHTML =
        res.backend === "github"
          ? `✓ Committed to GitHub as <code>${esc(res.path)}</code>`
          : `✓ Saved to Google Drive`;
      hint.textContent = res.note || "";
      toast(
        res.backend === "github"
          ? "Image pushed to GitHub"
          : "Image uploaded to Drive",
        "ok"
      );
    }
  }

  /* ---------------------------------------------------------
     Coupons
     --------------------------------------------------------- */
  function renderCoupons() {
    $("#tab-coupons").innerHTML = `
<div class="adm-hd">
  <div><h1 class="d3">Coupons</h1><p class="muted tiny">Discount codes customers can apply in the bag.</p></div>
  <button class="btn btn-sm" id="addCoupon">+ New coupon</button>
</div>
<div class="tbl-wrap">
  <table>
    <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Min order ₹</th><th>Active</th><th></th></tr></thead>
    <tbody>
      ${
        (DATA.coupons || []).length
          ? DATA.coupons
              .map(
                (c, i) => `<tr>
        <td style="font-family:var(--mono);font-weight:700">${esc(c.code)}</td>
        <td>${esc(c.type)}</td>
        <td>${c.type === "percent" ? c.value + "%" : money(c.value)}</td>
        <td>${money(c.minOrder || 0)}</td>
        <td><span class="pill ${Number(c.active) ? "delivered" : "cancelled"}">${Number(c.active) ? "Active" : "Off"}</span></td>
        <td><button class="btn btn-sm btn-ghost" data-cdel="${i}">Delete</button></td>
      </tr>`
              )
              .join("")
          : `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--tx-3)">No coupons yet.</td></tr>`
      }
    </tbody>
  </table>
</div>`;
    $("#addCoupon").onclick = () => {
      $("#modalBox").innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
  <h2 class="d3" style="font-size:1.3rem">New coupon</h2>
  <button class="icon-btn" id="mClose" style="font-size:1.5rem">&times;</button>
</div>
<div class="field"><label>Code</label><input id="c-code" placeholder="VIBES10" style="text-transform:uppercase"></div>
<div class="grid2">
  <div class="field"><label>Type</label><select id="c-type"><option value="percent">Percentage off</option><option value="flat">Flat ₹ off</option></select></div>
  <div class="field"><label>Value</label><input id="c-val" type="number" min="0" value="10"></div>
</div>
<div class="field"><label>Minimum order ₹</label><input id="c-min" type="number" min="0" value="799"></div>
<label class="fopt" style="margin-bottom:16px"><input type="checkbox" id="c-active" checked> Active</label>
<button class="btn btn-block" id="c-save">Create coupon</button>`;
      $("#modal").classList.add("on");
      $("#mClose").onclick = () => $("#modal").classList.remove("on");
      $("#c-save").onclick = async () => {
        const code = $("#c-code").value.trim().toUpperCase();
        if (!code) return toast("Enter a code", "err");
        const rec = {
          code,
          type: $("#c-type").value,
          value: Number($("#c-val").value) || 0,
          minOrder: Number($("#c-min").value) || 0,
          active: $("#c-active").checked ? 1 : 0,
        };
        const r = await api("saveCoupon", rec);
        if (r.ok) {
          write(LS.cache, null);
          toast("Coupon created");
          $("#modal").classList.remove("on");
          await refresh();
        }
      };
    };
    $$("[data-cdel]").forEach((b) => {
      b.onclick = async () => {
        const c = DATA.coupons[Number(b.dataset.cdel)];
        if (!confirm(`Delete coupon ${c.code}?`)) return;
        const r = await api("deleteCoupon", { code: c.code });
        if (r.ok) {
          write(LS.cache, null);
          toast("Coupon deleted");
          await refresh();
        }
      };
    });
  }

  /* ---------------------------------------------------------
     Settings
     --------------------------------------------------------- */
  function renderSettings() {
    const s = DATA.settings;
    $("#tab-settings").innerHTML = `
<div class="adm-hd"><div><h1 class="d3">Store settings</h1>
  <p class="muted tiny">These drive shipping charges, payment options and the announcement bar on every page.</p></div></div>

<div class="card" style="max-width:720px">
  <div class="grid2">
    <div class="field"><label>Shipping fee ₹</label><input id="s-ship" type="number" min="0" value="${Number(s.shippingFee) || 0}"></div>
    <div class="field"><label>Free shipping above ₹</label><input id="s-free" type="number" min="0" value="${Number(s.freeShippingAbove) || 0}"></div>
  </div>
  <div class="grid2">
    <div class="field"><label>COD handling fee ₹</label><input id="s-codfee" type="number" min="0" value="${Number(s.codFee) || 0}"></div>
    <div class="field"><label>Tax %</label><input id="s-tax" type="number" min="0" step="0.5" value="${Number(s.taxPercent) || 0}"></div>
  </div>
  <div class="field"><label>UPI ID for prepaid orders</label><input id="s-upi" value="${esc(s.upiId || CFG.UPI_ID)}"></div>
  <div class="field"><label>Announcement bar text (HTML allowed)</label><input id="s-ann" value="${esc(s.announcement || "")}" placeholder="Leave blank for the default rotating message"></div>
  <label class="fopt" style="margin-bottom:18px"><input type="checkbox" id="s-cod" ${Number(s.codEnabled) !== 0 && s.codEnabled !== false ? "checked" : ""}> Cash on delivery enabled</label>
  <button class="btn" id="s-save">Save settings</button>
</div>

<div class="card" style="max-width:720px;margin-top:16px">
  <h3 style="font-size:1.05rem;margin-bottom:10px">Backend</h3>
  <p class="tiny muted" style="margin-bottom:12px">Status: <b style="color:${live ? "var(--green)" : "var(--red)"}">${
      live ? "Connected to Google Sheets" : "Not connected"
    }</b></p>
  <p class="tiny muted" style="word-break:break-all">API URL: <code>${esc(CFG.API_URL || "— not set —")}</code></p>
  ${
    STORAGE && STORAGE.sheetUrl
      ? `<p class="tiny muted" style="margin-top:8px">Database: <a href="${esc(
          STORAGE.sheetUrl
        )}" target="_blank" rel="noopener" style="text-decoration:underline">open the Google Sheet ↗</a></p>`
      : ""
  }
  ${
    localStorage.getItem(API_OVERRIDE)
      ? `<div style="margin-top:14px;padding:14px;border-radius:12px;background:#fffbf0;border:1px solid var(--gold)">
          <b class="tiny" style="display:block;margin-bottom:6px">This connection is saved in this browser only</b>
          <p class="tiny muted" style="margin-bottom:10px">Customers load <code>assets/js/config.js</code> from the server, so the storefront still can't see live prices or place orders into your Sheet until you put the URL there too. Copy the line below into <code>config.js</code>, then commit and push.</p>
          <code style="display:block;padding:10px;border-radius:8px;background:var(--ink);color:#e9e7f5;font-size:.74rem;word-break:break-all;margin-bottom:10px">${esc(
            connectLine(CFG.API_URL)
          )}</code>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm" id="copyApiLine">Copy the line</button>
            <button class="btn btn-sm btn-ghost" id="disconnectApi">Disconnect this browser</button>
          </div>
        </div>`
      : ""
  }
  <p class="tiny muted" style="margin-top:10px">Open <code>SETUP.md</code> for the 5-minute deployment walkthrough.</p>
</div>

<div class="card" style="max-width:720px;margin-top:16px">
  <h3 style="font-size:1.05rem;margin-bottom:10px">Product image storage</h3>
  ${
    !live
      ? `<p class="tiny muted">Connect the backend to see where uploaded images go.</p>`
      : STORAGE && STORAGE.backend === "github"
      ? `<p class="tiny" style="margin-bottom:8px">Backend: <b style="color:var(--green)">GitHub</b> — images uploaded from the product editor are committed straight into your repository.</p>
         <p class="tiny muted">Repo <code>${esc(STORAGE.repo)}</code> · branch <code>${esc(STORAGE.branch)}</code> · folder <code>${esc(STORAGE.dir)}</code> · URL style <code>${esc(STORAGE.urlMode)}</code></p>
         <p class="tiny muted" style="margin-top:10px">Your GitHub token is stored in Apps Script Script Properties and never reaches this page or the published site.</p>`
      : `<p class="tiny" style="margin-bottom:8px">Backend: <b style="color:var(--gold)">Google Drive</b> — uploads are saved to a public folder in your Drive and served from Google's CDN. Nothing extra to configure.</p>
         <p class="tiny muted">Want images committed into your GitHub repo instead? Add <code>GH_TOKEN</code> and <code>GH_REPO</code> in Apps Script ▸ Project Settings ▸ Script Properties. See the "Product image uploads" section of <code>SETUP.md</code>.</p>`
  }
</div>

${
  (DATA.contacts || []).length
    ? `<div class="card" style="margin-top:16px">
  <h3 style="font-size:1.05rem;margin-bottom:12px">Recent enquiries</h3>
  <div class="tbl-wrap" style="border:0"><table><thead><tr><th>Date</th><th>Name</th><th>Contact</th><th>Message</th></tr></thead>
  <tbody>${DATA.contacts.slice(0, 15).map((c) => `<tr>
    <td class="tiny">${new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
    <td>${esc(c.name)}</td><td class="tiny">${esc(c.phone)}<br>${esc(c.email)}</td>
    <td class="tiny">${esc(c.message)}</td></tr>`).join("")}</tbody></table></div></div>`
    : ""
}`;

    const copyBtn = $("#copyApiLine");
    if (copyBtn)
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(connectLine(CFG.API_URL));
          toast("Copied — paste it into assets/js/config.js");
        } catch (e) {
          toast("Select the line above and copy it manually", "err");
        }
      };
    const disc = $("#disconnectApi");
    if (disc)
      disc.onclick = () => {
        if (!confirm("Disconnect this browser from the live backend?")) return;
        localStorage.removeItem(API_OVERRIDE);
        localStorage.removeItem(LS.cache);
        location.reload();
      };

    $("#s-save").onclick = async () => {
      const rec = {
        shippingFee: Number($("#s-ship").value) || 0,
        freeShippingAbove: Number($("#s-free").value) || 0,
        codFee: Number($("#s-codfee").value) || 0,
        taxPercent: Number($("#s-tax").value) || 0,
        upiId: $("#s-upi").value.trim(),
        announcement: $("#s-ann").value.trim(),
        codEnabled: $("#s-cod").checked ? 1 : 0,
      };
      const btn = $("#s-save");
      btn.classList.add("btn-loading");
      const r = await api("updateSettings", rec);
      btn.classList.remove("btn-loading");
      Object.assign(DATA.settings, rec);
      if (r.ok) {
        write(LS.cache, null);
        toast("Settings saved");
      }
    };
  }
})();
