/* ============ PIRANHA VIBES — Product detail ============ */
(async function () {
  const {
    $, $$, esc, money, qp, Store, bySlug, byCat, catMeta, cardHTML,
    Cart, Wish, ICON, toast, colorHex, pushRecent, read, LS, observe, CFG,
  } = window.PV;

  await Store.ready;
  window.PV.mountChrome("Shop All");

  const slug = qp("p");
  const p = bySlug(slug);
  const root = $("#pdRoot");

  if (!p || !p.active) {
    root.innerHTML = `<div style="text-align:center;padding:80px 20px">
      <h1 class="d2">Product not found</h1>
      <p class="lead" style="margin:14px auto 24px">This design may have been retired or the link is incorrect.</p>
      <a class="btn" href="shop.html">Browse the catalogue</a></div>`;
    return;
  }

  document.title = `${p.name} — Piranha Vibes`;
  const meta = catMeta(p.category);
  pushRecent(p.slug);

  $("#crumbs").innerHTML = `<a href="index.html">Home</a> <span>/</span>
    <a href="shop.html?cat=${p.category}">${esc(meta.name)}</a> <span>/</span>
    <span>${esc(p.name)}</span>`;

  const out = p.stock <= 0;
  const off = p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
  const low = !out && p.stock <= CFG.LOW_STOCK_THRESHOLD;

  const sizeGuide =
    p.category === "kids"
      ? "Kids sizes are chest width in inches: 22 ≈ 2–3 yrs, 24 ≈ 4–5 yrs, 26 ≈ 6–7 yrs, 28 ≈ 8–9 yrs, 30 ≈ 10–11 yrs, 32 ≈ 11–12 yrs."
      : p.category === "infant"
      ? "Infant sizes follow age in months. Rompers have a relaxed cut with press-button closure at the base."
      : p.category === "tote"
      ? "One size: 38 cm × 42 cm with 60 cm handles. Comfortably fits a 14-inch laptop, a water bottle and a day's essentials."
      : "Adult tees run in a relaxed regular fit — S (36\"), M (38\"), L (40\"), XL (42\"), 2XL (44\"), 3XL (46\") chest. Between sizes or want an oversized drape? Size up.";

  root.innerHTML = `
<div class="pd">
  <div class="pd-gal">
    <div class="pd-main" id="pdMain">
      <img id="pdImg" src="${p.image}" alt="${esc(p.name)}" width="900" height="1000"
           onerror="this.src='assets/img/brand/hero-main.webp'">
    </div>
    <div class="pd-thumbs" id="pdThumbs"></div>
  </div>

  <div class="pd-info">
    <span class="pc-cat">${esc(meta.name)}</span>
    <h1 class="d2" style="font-size:clamp(1.9rem,3.6vw,2.9rem);margin:10px 0 12px">${esc(p.name)}</h1>

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div class="stars">${ICON.star.repeat(5)}</div>
      <span class="tiny muted">Loved by the community</span>
    </div>

    <div style="display:flex;align-items:baseline;gap:12px;margin:16px 0 6px">
      <span style="font-size:1.9rem;font-weight:700">${money(p.price)}</span>
      ${p.mrp > p.price ? `<span class="pc-mrp" style="font-size:1.05rem">${money(p.mrp)}</span>` : ""}
      ${off ? `<span class="pc-off" style="font-size:.95rem">${off}% off</span>` : ""}
    </div>
    <p class="tiny muted">Inclusive of all taxes · Free shipping above ${money(Store.settings.freeShippingAbove)}</p>

    <p class="lead" style="font-size:1rem;margin-top:20px">${esc(p.desc)}</p>

    ${
      p.colors.length
        ? `<div class="opt-row">
            <div class="hd"><b>Colour</b><span class="tiny muted" id="colLabel">${esc(p.colors[0])}</span></div>
            <div class="chips" id="colChips">
              ${p.colors
                .map(
                  (c, i) =>
                    `<button class="chip${i === 0 ? " on" : ""}" data-col="${esc(c)}"
                      style="display:flex;align-items:center;gap:8px">
                      <i style="width:14px;height:14px;border-radius:50%;background:${colorHex(
                        c
                      )};border:1px solid rgba(0,0,0,.15);display:block"></i>${esc(c)}</button>`
                )
                .join("")}
            </div>
          </div>`
        : ""
    }

    ${
      p.sizes.length
        ? `<div class="opt-row">
            <div class="hd"><b>Size</b><button class="tiny muted" id="sizeGuideBtn" style="text-decoration:underline">Size guide</button></div>
            <div class="chips" id="sizeChips">
              ${p.sizes.map((s) => `<button class="chip" data-size="${esc(s)}">${esc(s)}</button>`).join("")}
            </div>
            <p class="tiny" id="sizeErr" style="color:var(--red);margin-top:8px;display:none">Please choose a size first</p>
          </div>`
        : ""
    }

    <div class="opt-row">
      <div class="hd"><b>Quantity</b>
        ${
          out
            ? `<span class="tiny" style="color:var(--red);font-weight:700">Sold out</span>`
            : low
            ? `<span class="tiny" style="color:var(--red);font-weight:700">Only ${p.stock} left</span>`
            : `<span class="tiny" style="color:var(--green);font-weight:700">In stock</span>`
        }
      </div>
      <div class="qty" style="border-radius:10px">
        <button id="qDec" aria-label="Decrease" style="width:38px;height:42px">−</button>
        <span id="qVal" style="min-width:44px">1</span>
        <button id="qInc" aria-label="Increase" style="width:38px;height:42px">+</button>
      </div>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:24px">
      <button class="btn btn-lg" id="addBtn" style="flex:1;min-width:190px" ${out ? "disabled" : ""}>
        ${out ? "Sold out" : "Add to bag"}
      </button>
      <button class="btn btn-lg btn-red" id="buyBtn" style="flex:1;min-width:190px" ${out ? "disabled" : ""}>Buy it now</button>
      <button class="icon-btn" id="wishBtn" aria-label="Save" style="width:54px;height:54px;border:1px solid var(--line)">${ICON.heart}</button>
    </div>

    <a class="btn btn-ghost btn-block btn-sm" style="margin-top:10px" target="_blank" rel="noopener"
       href="https://wa.me/${CFG.WHATSAPP}?text=${encodeURIComponent(
    "Hi Piranha Vibes! I'd like to order: " + p.name + " (" + p.sku + ")"
  )}">Order on WhatsApp instead</a>

    <div class="trust-row">
      <div>${ICON.truck}Dispatched in 48h</div>
      <div>${ICON.refresh}7-day easy returns</div>
      <div>${ICON.leaf}100% pure cotton</div>
    </div>

    <div class="acc" style="margin-top:30px">
      <div class="acc-i"><button class="acc-t">Product details <i></i></button>
        <div class="acc-c"><div>
          <b>SKU</b> ${esc(p.sku)}<br>
          <b>Collection</b> ${esc(meta.name)}<br>
          <b>Fabric</b> ${p.category === "tote" ? "12oz heavy canvas, reinforced stitched handles" : "Premium bio-washed combed cotton, pre-shrunk"}<br>
          <b>Print</b> Original Marathi typography, colour-locked cure<br>
          <b>Care</b> Machine wash cold, inside out. Do not bleach. Do not iron on print.<br>
          <b>Made in</b> Pune, Maharashtra, India
        </div></div>
      </div>
      <div class="acc-i"><button class="acc-t">Size &amp; fit <i></i></button>
        <div class="acc-c"><div>${esc(sizeGuide)}</div></div>
      </div>
      <div class="acc-i"><button class="acc-t">Shipping &amp; returns <i></i></button>
        <div class="acc-c"><div>
          Dispatched from our Pune studio within 48 hours. Delivery in 2–4 working days across Maharashtra and 4–7 working days elsewhere in India.
          Flat ${money(Store.settings.shippingFee)} shipping, free above ${money(Store.settings.freeShippingAbove)}.
          Cash on delivery available. Easy return or exchange within 7 days of delivery on unused, unwashed items with tags intact — size exchanges are free.
        </div></div>
      </div>
    </div>
  </div>
</div>`;

  /* ── gallery (single source image + zoom) ────────── */
  const thumbs = [p.image, "assets/img/brand/life-4.webp", "assets/img/brand/life-2.webp"];
  $("#pdThumbs").innerHTML = thumbs
    .map(
      (t, i) =>
        `<button class="${i === 0 ? "on" : ""}" data-th="${t}"><img src="${t}" alt="View ${
          i + 1
        }" onerror="this.parentElement.style.display='none'"></button>`
    )
    .join("");
  $$("#pdThumbs button").forEach((b) => {
    b.onclick = () => {
      $$("#pdThumbs button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      const img = $("#pdImg");
      img.style.opacity = 0;
      setTimeout(() => {
        img.src = b.dataset.th;
        img.style.opacity = 1;
      }, 160);
    };
  });
  const main = $("#pdMain");
  main.addEventListener("mousemove", (e) => {
    if (!main.classList.contains("zoom")) return;
    const r = main.getBoundingClientRect();
    $("#pdImg").style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${
      ((e.clientY - r.top) / r.height) * 100
    }%`;
  });
  main.addEventListener("click", () => main.classList.toggle("zoom"));
  main.addEventListener("mouseleave", () => main.classList.remove("zoom"));

  /* ── options ─────────────────────────────────────── */
  let size = p.sizes.length === 1 ? p.sizes[0] : "";
  let color = p.colors[0] || "";
  let qty = 1;
  if (p.sizes.length === 1) $$("#sizeChips .chip").forEach((c) => c.classList.add("on"));

  $$("#sizeChips .chip").forEach((c) => {
    c.onclick = () => {
      $$("#sizeChips .chip").forEach((x) => x.classList.remove("on"));
      c.classList.add("on");
      size = c.dataset.size;
      $("#sizeErr").style.display = "none";
    };
  });
  $$("#colChips .chip").forEach((c) => {
    c.onclick = () => {
      $$("#colChips .chip").forEach((x) => x.classList.remove("on"));
      c.classList.add("on");
      color = c.dataset.col;
      $("#colLabel").textContent = color;
    };
  });
  $("#qInc").onclick = () => {
    if (p.stock > 0 && qty >= p.stock) return toast(`Only ${p.stock} in stock`, "err");
    $("#qVal").textContent = ++qty;
  };
  $("#qDec").onclick = () => {
    if (qty > 1) $("#qVal").textContent = --qty;
  };

  const wb = $("#wishBtn");
  if (Wish.has(p.slug)) wb.classList.add("on");
  wb.style.color = Wish.has(p.slug) ? "var(--red)" : "";
  wb.onclick = () => {
    const on = Wish.toggle(p.slug);
    wb.querySelector("svg").style.fill = on ? "var(--red)" : "none";
    wb.querySelector("svg").style.stroke = on ? "var(--red)" : "var(--ink)";
    toast(on ? "Saved to wishlist" : "Removed from wishlist");
  };

  function tryAdd() {
    if (p.sizes.length > 1 && !size) {
      $("#sizeErr").style.display = "block";
      const chipsEl = $("#sizeChips");
      if (chipsEl) {
        chipsEl.classList.remove("chips-highlight");
        void chipsEl.offsetWidth; // force reflow for smooth animation replay
        chipsEl.classList.add("chips-highlight");
        setTimeout(() => chipsEl.classList.remove("chips-highlight"), 1200);
        chipsEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      toast("Please select a size first", "err");
      return false;
    }
    return Cart.add(p.slug, size, color, qty);
  }
  $("#addBtn").onclick = () => {
    if (tryAdd()) {
      toast(`${p.name} added to your bag`);
      window.PV_openCart();
    }
  };
  $("#buyBtn").onclick = () => {
    if (tryAdd()) location.href = "checkout.html";
  };
  $("#sizeGuideBtn") &&
    ($("#sizeGuideBtn").onclick = () => {
      const acc = $$(".acc-i")[1];
      acc.querySelector(".acc-t").click();
      acc.scrollIntoView({ behavior: "smooth", block: "center" });
    });

  /* ── accordions ──────────────────────────────────── */
  $$(".acc-t").forEach((btn) => {
    btn.onclick = () => {
      const item = btn.parentElement;
      const body = btn.nextElementSibling;
      const open = item.classList.contains("on");
      item.classList.toggle("on", !open);
      body.style.maxHeight = open ? null : body.scrollHeight + "px";
    };
  });

  /* ── related + recently viewed ───────────────────── */
  const rel = byCat(p.category).filter((x) => x.slug !== p.slug).slice(0, 4);
  if (rel.length) {
    $("#relatedSec").style.display = "";
    $("#related").innerHTML = rel.map(cardHTML).join("");
  }
  const recent = read(LS.recent, [])
    .filter((s) => s !== p.slug)
    .map(bySlug)
    .filter((x) => x && x.active)
    .slice(0, 4);
  if (recent.length) {
    $("#recentSec").style.display = "";
    $("#recent").innerHTML = recent.map(cardHTML).join("");
  }
  observe();
})();
