/* =============================================================
   PIRANHA VIBES — Global configuration
   -------------------------------------------------------------
   1. Deploy google-apps-script/Code.gs as a Web App (see SETUP.md)
   2. Paste the /exec URL below into API_URL
   3. Everything (products, pricing, stock, orders) then lives in
      your Google Sheet. Until then the site runs on the local
      seed catalog in data.js so it is always fully working.
   ============================================================= */

window.PV_CONFIG = {
  // ── Google Sheets backend ────────────────────────────────────
  API_URL: "", // e.g. "https://script.google.com/macros/s/AKfy.../exec"

  // ── Brand ────────────────────────────────────────────────────
  BRAND: "Piranha Vibes",
  TAGLINE: "Rooted by Core",
  EMAIL: "piranhavibes@gmail.com",
  PHONE: "+91 8087691321",
  WHATSAPP: "918087691321",
  ADDRESS:
    "Anuneel, Swami Vivekanand Park, Walhekarwadi, Chinchwad, Pune 411033",
  INSTAGRAM: "https://www.instagram.com/piranhavibes",
  FACEBOOK: "https://www.facebook.com/piranhavibes",

  // ── Commerce defaults (overridden by the Settings sheet) ─────
  CURRENCY: "₹",
  SHIPPING_FEE: 60,
  FREE_SHIPPING_ABOVE: 999,
  COD_ENABLED: true,
  COD_FEE: 0,
  UPI_ID: "piranhavibes@upi",
  TAX_PERCENT: 0,

  // ── Behaviour ────────────────────────────────────────────────
  LOW_STOCK_THRESHOLD: 5,
  CACHE_MINUTES: 5,
};
