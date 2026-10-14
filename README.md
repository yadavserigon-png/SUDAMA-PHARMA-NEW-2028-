# Sudama Pharma Platform

Online pharmacy + multi-store management platform for **Sudama Private Limited** (founder: Nitesh Kumar), built from scratch for Bihar, India.

This is a **completely new, independent project**. It does not use, read or change the old `sudama-pharma-2028` GitHub repository, its database, hosting or environment variables. It uses its own database `sudama_pharma_platform` and its own `.env` files.

| Part | Folder | Tech | Local URL |
|---|---|---|---|
| API | `backend/` | Node.js 22, Express, MongoDB (Mongoose) | http://localhost:5000 |
| Website, admin panel, POS, delivery app (PWA) | `frontend/` | React 18, Vite, React Router, Leaflet (OpenStreetMap) | http://localhost:5173 |
| Android app | `frontend/` via Capacitor | same website packaged | - |

## Quick start (Windows, VS Code)

Full step-by-step PowerShell guide: **[docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md)**. Short version:

```powershell
# 1. Prerequisites: Node.js 22 LTS, MongoDB Community 7 (or a free MongoDB Atlas cluster), Git, VS Code
cd C:\Projects\sudama-pharma-platform          # the unzipped folder

# 2. Install
npm run install:all

# 3. Configure the API
Copy-Item backend\.env.example backend\.env
notepad backend\.env      # set JWT_SECRET and SETUP_TOKEN (see the guide)

# 4. Base categories (optional, recommended) and owner account
cd backend
npm run seed:base
npm run init:admin        # asks for YOUR password - never stored in code
cd ..

# 5. Run both apps
npm run dev
```

Open http://localhost:5173 → **Log in** with 9264289295 and the password you chose → Admin → **Stores** → add your stores.

In VS Code you can also use **Terminal → Run Task → "Run Sudama Pharma (both)"**.

## What is inside

- **Customer website** – search by name / brand / salt / SKU / barcode, categories, product pages with composition and per-store availability, cart, checkout with address + PIN serviceability, prescription upload (camera or PDF), medicine requests, coupons, COD and PhonePe, live order tracking with delivery OTP, returns, support tickets, store locator map, wholesale portal, partner applications, installable PWA.
- **Admin panel** (`/admin`) – store selector (All stores / each store) on every screen, dashboard, sales & profit reports (Excel download), stores with map + delivery radius, products, categories, batch inventory with expiry alerts (180/90/60/30/7 days), low/out-of-stock, fast/slow/dead stock, stock ledger, physical counts, transfers, suppliers, purchases (boxes/strips/units, free goods, landed cost, GRN, partial receipt, returns, payments), orders workflow, pharmacist prescription review, medicine requests, WhatsApp inbox, delivery management + live map, users & 14 roles with per-user permission overrides, attendance/leave/tasks/performance, payments + reconciliation, refunds (maker–checker), expenses with approval, coupons, support tickets, ads & partner onboarding, Excel/CSV import-export, settings (branding, policies, payments, expiry), audit log.
- **POS billing counter** (`/pos`) – shifts with cash reconciliation, USB/Bluetooth scanner + phone camera + name search, FEFO batch selection, expired/blocked batch protection, duplicate-scan guard, price override only with permission + reason, prescription verification, coupon, cash/UPI/card/credit, receipt print, 80 mm & A4 PDF invoices, sales returns, cash refunds, daily counter report, barcode registration for unknown codes.
- **Delivery partner app** (`/delivery`) – online/offline, assignments, pickup, navigation, call customer, OTP proof of delivery, COD collection, failure + return-to-store, earnings, document upload; GPS shared only during an active delivery.

## Documentation

- [docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md) – local setup, MongoDB, environment variables, testing APIs, Git/GitHub (new repository only)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) – independent hosting, HTTPS, free-tier limits and costs, PhonePe & WhatsApp go-live
- [docs/ANDROID.md](docs/ANDROID.md) – Android build with Capacitor, signing, permissions, privacy, Play Store submission
- [docs/FEATURES.md](docs/FEATURES.md) – feature completion report and honest test status
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md) – legal/regulatory items to complete before selling medicines online
- [docs/API.md](docs/API.md) – REST API overview

## Tests

```powershell
cd backend
npm test            # unit tests (pricing, coupons, purchase maths, FEFO, expiry, roles) + full API integration tests
npm run test:unit   # only the pure business-logic tests (no database needed)
```

The integration tests start an in-memory MongoDB automatically (downloads a MongoDB binary once, ~70 MB).

## Important honesty notes

- No medicine data, barcodes or prices are pre-filled. Add products from verified pack/invoice data (admin form or Excel import).
- PhonePe, WhatsApp Business API and SMS/email are **integration points**: they start working only after you complete onboarding and put the credentials in `backend/.env`. Until then the site shows cash-on-delivery, click-to-chat and manual flows, and says so.
- The software does not by itself make the business legally compliant – see [docs/COMPLIANCE.md](docs/COMPLIANCE.md).
