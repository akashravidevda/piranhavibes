/* ============ PIRANHA VIBES — Shop / catalogue ============ */
(async function () {
  const { $, $$, esc, money, Store, catMeta, cardHTML, qp, observe } = window.PV;

  await Store.ready;
  window.PV.mountChrome("Shop All");

  const state = {
    cats: new Set(),
    sizes: new Set(),
    price: null, // [min,max]
    inStock: false,
    sort: "featured",
    q: (qp("q") || "").trim(),
  };
  const startCat = qp("cat");
  if (startCat) state.cats.add(startCat);

  const all = () => Store.products.filter((p) => p.active);

  /* ── page heading reflects the entry category ────── */
  function paintHeading() {
    const t = $("#shopTitle"),
      b = $("#shopBlurb"),
      c = $("#crumbNow");
    if (state.cats.size === 1) {
      const m = catMeta(Array.from(state.cats)[0]);
      t.textContent = m.name;
      b.textContent = m.blurb || "";
      c.textContent = m.name;
      document.title = m.name + " — Piranha Vibes";
    } else if (state.q) {
      t.textContent = `Results for “${state.q}”`;
      b.textContent = "";
      c.textContent = "Search";
    } else {
      t.textContent = "Shop All";
      b.textContent =
        "Every design we make, in one place. Premium cotton, original Marathi typography, made in Pune.";
      c.textContent = "Shop";
    }
  }

  /* ── filter panels ───────────────────────────────── */
  const PRICE_BANDS = [
    ["Under ₹300", 0, 299],
    ["₹300 – ₹399", 300, 399],
    ["₹400 – ₹499", 400, 499],
    ["₹500 & above", 500, 1e9],
  ];

  function buildFilters() {
    $("#fCats").innerHTML = Store.categories
      .map((c) => {
        const n = all().filter((p) => p.category === c.id).length;
        return `<label class="fopt"><input type="checkbox" data-cat="${
          c.id
        }" ${state.cats.has(c.id) ? "checked" : ""}> ${esc(
          c.name
        )} <span class="n">${n}</span></label>`;
      })
      .join("");

    const sizes = [];
    all().forEach((p) => p.sizes.forEach((s) => sizes.indexOf(s) < 0 && sizes.push(s)));
    const rank = (s) => {
      const o = ["0-6M","6-12M","12-18M","18-24M","22","24","26","28","30","32","S","M","L","XL","2XL","3XL","One Size"];
      const i = o.indexOf(s);
      return i < 0 ? 99 : i;
    };
    sizes.sort((a, b) => rank(a) - rank(b));
    $("#fSizes").innerHTML = sizes
      .map(
        (s) =>
          `<label class="fopt"><input type="checkbox" data-size="${esc(
            s
          )}" ${state.sizes.has(s) ? "checked" : ""}> ${esc(s)}</label>`
      )
      .join("");

    $("#fPrice").innerHTML = PRICE_BANDS.map(
      (b, i) =>
        `<label class="fopt"><input type="radio" name="pb" data-price="${i}" ${
          state.price === i ? "checked" : ""
        }> ${b[0]}</label>`
    ).join("");
  }

  /* ── filtering ───────────────────────────────────── */
  function apply() {
    let list = all();
    if (state.q) {
      const q = state.q.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          catMeta(p.category).name.toLowerCase().includes(q) ||
          p.desc.toLowerCase().includes(q)
      );
    }
    if (state.cats.size) list = list.filter((p) => state.cats.has(p.category));
    if (state.sizes.size)
      list = list.filter((p) => p.sizes.some((s) => state.sizes.has(s)));
    if (state.price != null) {
      const b = PRICE_BANDS[state.price];
      list = list.filter((p) => p.price >= b[1] && p.price <= b[2]);
    }
    if (state.inStock) list = list.filter((p) => p.stock > 0);

    const s = state.sort;
    list.sort((a, b) => {
      if (s === "pl") return a.price - b.price;
      if (s === "ph") return b.price - a.price;
      if (s === "az") return a.name.localeCompare(b.name);
      if (s === "new") return (b.badge === "New") - (a.badge === "New");
      return b.featured - a.featured || a.price - b.price;
    });
    // sold-out always last
    list.sort((a, b) => (a.stock > 0 ? 0 : 1) - (b.stock > 0 ? 0 : 1));
    return list;
  }

  function chips() {
    const out = [];
    state.cats.forEach((c) =>
      out.push(`<span class="chip-clear">${esc(
        catMeta(c).name
      )} <b data-x="cat:${c}">×</b></span>`)
    );
    state.sizes.forEach((s) =>
      out.push(`<span class="chip-clear">Size ${esc(s)} <b data-x="size:${esc(
        s
      )}">×</b></span>`)
    );
    if (state.price != null)
      out.push(
        `<span class="chip-clear">${PRICE_BANDS[state.price][0]} <b data-x="price:">×</b></span>`
      );
    if (state.inStock)
      out.push(`<span class="chip-clear">In stock <b data-x="stock:">×</b></span>`);
    $("#activeChips").innerHTML = out.join("");
  }

  function render() {
    const list = apply();
    $("#resCount").textContent = `${list.length} product${
      list.length === 1 ? "" : "s"
    }`;
    $("#grid").innerHTML = list.map(cardHTML).join("");
    $("#noRes").classList.toggle("hidden", list.length > 0);
    chips();
    paintHeading();
    // sync URL so filtered views are shareable
    const u = new URL(location.href);
    u.search = "";
    if (state.cats.size === 1) u.searchParams.set("cat", Array.from(state.cats)[0]);
    if (state.q) u.searchParams.set("q", state.q);
    history.replaceState(null, "", u);
    observe();
  }

  /* ── events ──────────────────────────────────────── */
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.cat) {
      t.checked ? state.cats.add(t.dataset.cat) : state.cats.delete(t.dataset.cat);
      render();
    }
    if (t.dataset.size) {
      t.checked ? state.sizes.add(t.dataset.size) : state.sizes.delete(t.dataset.size);
      render();
    }
    if (t.dataset.price != null && t.dataset.price !== "") {
      state.price = Number(t.dataset.price);
      render();
    }
    if (t.id === "fStock") {
      state.inStock = t.checked;
      render();
    }
    if (t.id === "sortSel") {
      state.sort = t.value;
      render();
    }
  });

  $("#activeChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    const [k, v] = b.dataset.x.split(":");
    if (k === "cat") state.cats.delete(v);
    if (k === "size") state.sizes.delete(v);
    if (k === "price") state.price = null;
    if (k === "stock") state.inStock = false;
    buildFilters();
    $("#fStock").checked = state.inStock;
    render();
  });

  function clearAll() {
    state.cats.clear();
    state.sizes.clear();
    state.price = null;
    state.inStock = false;
    state.q = "";
    buildFilters();
    $("#fStock").checked = false;
    render();
  }
  $("#fClear").onclick = clearAll;
  $("#noResClear").onclick = clearAll;
  $("#fToggle").onclick = () => $("#filters").classList.toggle("on");

  buildFilters();
  render();
})();
