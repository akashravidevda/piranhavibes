/* ============ PIRANHA VIBES — Homepage ============ */
(async function () {
  const { $, $$, esc, money, Store, byCat, catMeta, cardHTML, ICON, toast } =
    window.PV;

  await Store.ready;
  window.PV.mountChrome("Home");

  /* ── marquee ─────────────────────────────────────── */
  const words = [
    "Rooted by Core",
    "Marathi at heart",
    "Premium cotton",
    "For you & your loved ones",
    "Dispatched in 48 hours",
    "Original typography",
  ];
  const line = words.map((w) => `<span>${w}</span>`).join("");
  $("#marqTrack").innerHTML = line + line;

  /* ── feature strip ───────────────────────────────── */
  const feats = [
    [ICON.truck, "Quick Dispatch", "Every order leaves our Pune studio within 48 hours."],
    [ICON.leaf, "High Quality Cotton", "Soft, pure, bio-washed cotton that keeps its shape."],
    [ICON.refresh, "Easy Returns", "Free return or exchange within 7 days of delivery."],
    [ICON.shield, "Secure Checkout", "Cash on delivery and UPI — pay the way you prefer."],
  ];
  $("#featGrid").innerHTML = feats
    .map(
      (f) => `<div class="feat"><div class="ic">${f[0]}</div>
        <h4>${f[1]}</h4><p>${f[2]}</p></div>`
    )
    .join("");

  /* ── category tiles ──────────────────────────────── */
  const order = ["kids", "women", "men", "tote", "yoga", "infant"];
  $("#catGrid").innerHTML = order
    .map((id) => {
      const c = catMeta(id);
      const n = byCat(id).length;
      const img = (byCat(id)[0] || {}).image || c.image;
      return `<a class="cat-card" href="shop.html?cat=${id}">
        <img src="${img}" alt="${esc(c.name)}" loading="lazy">
        <span class="go">${ICON.arrow}</span>
        <div>
          <span class="cnt">${n} product${n === 1 ? "" : "s"}</span>
          <h3>${esc(c.name)}</h3>
          <p>${esc(c.headline || "")}</p>
        </div>
      </a>`;
    })
    .join("");

  /* ── product rails ───────────────────────────────── */
  $$("[data-rail]").forEach((wrapEl) => {
    const cat = wrapEl.dataset.rail;
    const items = byCat(cat);
    if (!items.length) {
      wrapEl.innerHTML = `<p class="muted">Restocking soon.</p>`;
      return;
    }
    const id = "rail-" + cat;
    wrapEl.innerHTML = `
      <div class="rail" id="${id}">${items.map(cardHTML).join("")}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;gap:16px;flex-wrap:wrap">
        <a class="btn btn-ghost btn-sm" href="shop.html?cat=${cat}">See all ${esc(
      catMeta(cat).name
    )}</a>
        <div class="rail-nav">
          <button data-scroll="-1" aria-label="Previous"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button data-scroll="1" aria-label="Next"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </div>`;
    const rail = $("#" + id, wrapEl);
    $$("[data-scroll]", wrapEl).forEach((b) => {
      b.onclick = () =>
        rail.scrollBy({
          left: Number(b.dataset.scroll) * Math.min(rail.clientWidth * 0.8, 700),
          behavior: "smooth",
        });
    });
  });

  /* ── testimonials ────────────────────────────────── */
  $("#tstGrid").innerHTML = (window.PV_TESTIMONIALS || [])
    .map(
      (t) => `<div class="tst">
      <div class="stars">${ICON.star.repeat(5)}</div>
      <p>“${esc(t.text)}”</p>
      <div class="who"><span class="av">${esc(
        t.name.charAt(0)
      )}</span><div><b>${esc(t.name)}</b><span>${esc(
        t.place
      )} · Verified buyer</span></div></div>
    </div>`
    )
    .join("");

  /* ── FAQ accordion ───────────────────────────────── */
  const faqs = [
    [
      "How long does delivery take?",
      "Every order is dispatched from our Pune studio within 48 hours. Delivery typically takes 2–4 working days within Maharashtra and 4–7 working days elsewhere in India. You'll get a tracking reference by SMS and email once the parcel is handed to the courier.",
    ],
    [
      "What are the shipping charges?",
      `Shipping is a flat ${money(
        Store.settings.shippingFee
      )} and completely free on all orders above ${money(
        Store.settings.freeShippingAbove
      )}. Cash on delivery is available across India at no extra cost.`,
    ],
    [
      "How do I pick the right size?",
      "Kids sizes run 22–32 and correspond to chest width in inches (size 22 fits roughly 2–3 years, 32 fits roughly 11–12 years). Adult tees run S to 3XL in a relaxed regular fit — if you're between two sizes or prefer an oversized drape, size up. Tote bags are one size, 38 × 42 cm.",
    ],
    [
      "What is the return and exchange policy?",
      "Easy return or exchange within 7 days of delivery, as long as the product is unused, unwashed and has its tags intact. Message us on WhatsApp or email with your order ID and we'll arrange a pickup. Size exchanges are free.",
    ],
    [
      "How should I wash my tee so the print lasts?",
      "Machine wash cold, inside out, with similar colours. Avoid bleach and don't iron directly over the print. Our prints are cured into the weave, so with normal care the design outlasts the garment.",
    ],
    [
      "Do you take bulk or custom orders?",
      `Yes — we take bulk orders for families, teams, colleges and events, with custom Marathi typography available. Email ${window.PV.CFG.EMAIL} or WhatsApp ${window.PV.CFG.PHONE} with your quantity and we'll share a quote.`,
    ],
  ];
  $("#faqAcc").innerHTML = faqs
    .map(
      (f) => `<div class="acc-i"><button class="acc-t">${esc(
        f[0]
      )} <i></i></button>
      <div class="acc-c"><div>${esc(f[1])}</div></div></div>`
    )
    .join("");
  $$(".acc-t", $("#faqAcc")).forEach((btn) => {
    btn.onclick = () => {
      const item = btn.parentElement;
      const body = btn.nextElementSibling;
      const open = item.classList.contains("on");
      $$(".acc-i", $("#faqAcc")).forEach((i) => {
        i.classList.remove("on");
        i.querySelector(".acc-c").style.maxHeight = null;
      });
      if (!open) {
        item.classList.add("on");
        body.style.maxHeight = body.scrollHeight + "px";
      }
    };
  });

  /* ── contact block ───────────────────────────────── */
  const C = window.PV.CFG;
  $("#contactBlock").innerHTML = `
    <div class="tick">${ICON.mail}<p><b>Email</b><a href="mailto:${
    C.EMAIL
  }">${C.EMAIL}</a></p></div>
    <div class="tick">${ICON.phone}<p><b>Phone</b><a href="tel:${C.PHONE.replace(
    /\s/g,
    ""
  )}">${C.PHONE}</a></p></div>
    <div class="tick">${ICON.pin}<p><b>Office</b>${esc(C.ADDRESS)}</p></div>`;

  /* ── contact form ────────────────────────────────── */
  $("#contactForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const fields = ["name", "phone", "email", "message"];
    let ok = true;
    fields.forEach((n) => {
      const el = f[n];
      const wrap = el.closest(".field");
      let bad = !el.value.trim();
      if (n === "phone") bad = !/^[6-9]\d{9}$/.test(el.value.replace(/\D/g, "").slice(-10));
      if (n === "email") bad = !/^\S+@\S+\.\S+$/.test(el.value);
      wrap.classList.toggle("err", bad);
      if (bad) ok = false;
    });
    if (!ok) return;
    const btn = f.querySelector("button");
    btn.classList.add("btn-loading");
    try {
      await window.PV.send("contact", {
        name: f.name.value,
        phone: f.phone.value,
        email: f.email.value,
        message: f.message.value,
      });
    } catch (err) {
      /* backend optional — fall through to the confirmation */
    }
    btn.classList.remove("btn-loading");
    f.reset();
    toast("Thanks! We'll get back to you shortly.");
  });

  /* ── newsletter ──────────────────────────────────── */
  $("#nlForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = e.target.querySelector("input");
    if (!/^\S+@\S+\.\S+$/.test(inp.value))
      return toast("Enter a valid email address", "err");
    try {
      await window.PV.send("subscribe", { email: inp.value });
    } catch (err) {}
    inp.value = "";
    toast("You're on the list. Welcome to the vibe!");
  });

  window.PV.observe();
})();
