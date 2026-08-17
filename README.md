# Piranha Vibes — Premium Storefront

**Live:** <https://piranhavibes.com> · **Admin:** <https://piranhavibes.com/admin.html>

A complete, fully working rebuild of piranhavibes.com in plain HTML, CSS and
JavaScript, with **Google Sheets as the database** and a built-in admin panel
for pricing, stock and orders.

No accounts, no login/signup — customers just order. No build step, no
framework, no dependencies.

---

## What's in the box

| Page                | What it does                                                                        |
| ------------------- | ------------------------------------------------------------------------------------ |
| `index.html`        | Homepage — hero, collections, per-category product rails, brand story, community gallery, testimonials, FAQ, contact form, newsletter |
| `shop.html`         | Full catalogue with category / size / price / availability filters, sorting and shareable filtered URLs |
| `product.html`      | Product detail — zoomable gallery, colour + size pickers, quantity, stock state, spec accordions, related products, recently viewed |
| `cart.html`         | Full bag with quantity editing, coupon codes, free-shipping progress |
| `checkout.html`     | Address + payment (Cash on Delivery / UPI) with real validation |
| `order-success.html`| Order confirmation with ID, itemised summary and delivery address |
| `track.html`        | Order lookup by ID + phone, with a five-stage status timeline |
| `admin.html`        | Dashboard, order management, pricing & stock editor, image uploads, coupons, store settings |

Plus a slide-out cart drawer, ⌘K search overlay, wishlist, WhatsApp ordering
fallback and toast notifications on every page.

## Design

Editorial-premium: ink navy and signal red pulled from the real logo, warm
paper background, Fraunces display serif against Plus Jakarta Sans, paper-grain
texture, and motion throughout — scroll reveals, staggered grids, marquees,
magnetic buttons, image parallax, count-up stats, drawer and modal transitions.
Fully responsive from 360 px up, and it respects `prefers-reduced-motion`.

## Content

Every product, price, category, description and contact detail is taken from
the live piranhavibes.com — 31 products across Kids Wear, Women, Men, Tote
Bags, Yoga and Infant Wear, with the real product photography and logo
downloaded into `assets/img/`.

## Quick start

```bash
cd piranha-vibes && python -m http.server 5199
```

Open <http://localhost:5199>. The store is fully functional right away using
the seed catalogue in `assets/js/data.js`.

To make it live — orders landing in a spreadsheet, prices and stock editable
from the admin panel — follow **[SETUP.md](SETUP.md)**. It takes about ten
minutes.

## Structure

```
piranha-vibes/
├── index.html  shop.html  product.html  cart.html
├── checkout.html  order-success.html  track.html  admin.html
├── assets/
│   ├── css/style.css        design system + all page styles
│   ├── js/
│   │   ├── config.js        ← your API URL, brand details, defaults
│   │   ├── data.js          seed catalogue (offline fallback)
│   │   ├── app.js           API client, catalog store, cart, chrome, motion
│   │   ├── home.js  shop.js  product.js  cart.js  checkout.js  admin.js
│   └── img/
│       ├── brand/           logo + lifestyle photography
│       └── products/        31 product images
├── google-apps-script/
│   └── Code.gs              the entire backend, one file
├── SETUP.md
└── README.md
```

## How the data flows

```
Google Sheet  ──catalog──▶  browser cache (5 min)  ──▶  storefront
     ▲                                                      │
     └────────── order / stock decrement ◀──────────────────┘
     ▲
     └────────── price, stock, settings ◀──── admin.html (admin key)
```

### Product images

Drop a photo into the admin product editor and it is resized to 1200 px,
converted to WebP in the browser, then uploaded through Apps Script and
**committed straight into your GitHub repo** (`assets/img/products/`) — a real
commit, exactly like the seeded product photos.

No credential is ever exposed: the GitHub token lives in Apps Script Script
Properties, so it never appears in `config.js`, in the published site, or in
any request the browser can see. See
[SETUP.md ▸ Product image uploads](SETUP.md#product-image-uploads).

If the backend is unreachable the site silently falls back to the local seed
catalogue, and any order placed is still given an ID and saved on the
customer's device so nothing is lost — the confirmation page then asks them to
confirm on WhatsApp.

## Configuration

Everything you'd normally want to change lives at the top of
`assets/js/config.js`: the API URL, brand name, email, phone, WhatsApp number,
address, social links, currency, shipping defaults, UPI ID and the low-stock
threshold. Once the backend is connected, the commerce values are driven by the
**Settings** sheet instead, editable from Admin ▸ Settings.

## Browser support

Current Chrome, Edge, Firefox and Safari, desktop and mobile.
