# Deployment (independent of the old project)

Use **new** accounts/services for everything below: a new GitHub repository, a new MongoDB database `sudama_pharma_platform`, new hosting projects and new environment variables. Nothing here touches the old `sudama-pharma-2028` website or its hosting.

There are two sensible paths:

| | A. Free demo / pilot | B. Production (real customers) |
|---|---|---|
| Database | MongoDB Atlas free (M0) | Atlas paid tier with automated backups, or self-managed MongoDB with scheduled `mongodump` |
| API | Render free web service | Small VPS (Ubuntu) with Nginx + PM2, or a paid Render plan with a persistent disk |
| Website | Netlify / Vercel / Cloudflare Pages free | same (free tiers are fine for a static site) |
| HTTPS | automatic on all three | automatic on hosts; Let's Encrypt (certbot) on a VPS |

## Free-tier limitations you must know (check current terms – they change)

- **Atlas M0**: small storage limit (about 512 MB), shared CPU, no point-in-time backups. Fine for a pilot catalogue, not for years of orders.
- **Render free**: the API sleeps after ~15 minutes without traffic, so the first request after a pause takes up to a minute; monthly free hours are limited; **the disk is temporary** – uploaded prescriptions, product photos and receipts are lost on every restart or redeploy. For anything beyond a demo, use a plan with a persistent disk or a VPS (path B). Prescriptions must not be lost.
- **Netlify / Vercel / Cloudflare Pages**: generous for static sites; bandwidth limits apply.
- **OpenStreetMap tiles**: the public tile server is for light use. With many daily users, switch the tile URL in `frontend/src/components/Maps.jsx` to a commercial OSM tile provider (MapTiler, Stadia, Thunderforest – free tiers exist, then paid).
- Expect costs when you grow: database tier with backups, an always-on API server, SMS/OTP credits, WhatsApp conversation charges (Meta), PhonePe transaction fees, domain name.

## Step 11 – Deploy the frontend (Netlify example)

1. Netlify → **Add new site → Import from Git** → choose the NEW repository.
2. Base directory `frontend`, build command `npm run build`, publish directory `frontend/dist`.
3. Environment variable `VITE_API_URL=https://<your-api-domain>` (set after step 12; redeploy afterwards).
4. `frontend/public/_redirects` is already included, so deep links like `/admin/orders` work. (Vercel uses `frontend/vercel.json`; Cloudflare Pages uses `_redirects` too.)

## Step 12 – Deploy the backend

### Path A: Render

1. Render → **New → Web Service** → connect the NEW repository.
2. Root directory `backend`, build command `npm install`, start command `npm start`, Node version 22.
3. Environment variables (Render → Environment):
   ```
   NODE_ENV=production
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/sudama_pharma_platform?retryWrites=true&w=majority
   JWT_SECRET=<64+ random characters>
   CORS_ORIGIN=https://<your-site-domain>
   APP_BASE_URL=https://<your-site-domain>
   API_BASE_URL=https://<your-api-domain>
   TRUST_PROXY=true
   ```
4. After the first deploy, create the owner once: Render → Shell → `npm run init:admin` (or temporarily set `SETUP_TOKEN` and use `/setup`, then delete `SETUP_TOKEN`).

### Path B: VPS (Ubuntu 22.04/24.04)

```bash
sudo apt update && sudo apt install -y nginx git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2
git clone https://github.com/<you>/sudama-pharma-platform.git && cd sudama-pharma-platform/backend
npm ci --omit=dev
cp .env.example .env && nano .env          # production values as above, UPLOAD_DIR=/var/lib/sudama/uploads
sudo mkdir -p /var/lib/sudama/uploads && sudo chown $USER /var/lib/sudama/uploads
npm run init:admin
pm2 start src/server.js --name sudama-api && pm2 save && pm2 startup
```

Nginx site (`/etc/nginx/sites-available/sudama-api`):

```nginx
server {
  server_name api.yourdomain.in;
  client_max_body_size 12m;
  location / { proxy_pass http://127.0.0.1:5000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
}
```

## Step 13 – HTTPS

- Netlify / Vercel / Render: add your custom domain in their dashboard and point the DNS records they show; certificates are issued and renewed automatically.
- VPS: `sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d api.yourdomain.in` (auto-renews).
- HTTPS is required for: camera barcode scanning, GPS for delivery partners, PWA install, PhonePe and WhatsApp webhooks.

## Step 14 – Test the live website

- [ ] `https://<api>/api/health` returns `{ ok: true }`
- [ ] Log in as owner; create Store 1–3 with map location and radius; create a store manager limited to Store 1 and confirm they cannot see Store 2
- [ ] Add a product with verified data, receive stock through a purchase (batch + expiry), check Inventory
- [ ] POS: open shift, scan with a USB scanner and with phone camera, bill, print receipt, close shift
- [ ] Customer: register on a phone, check PIN serviceability, order with prescription, approve as pharmacist, pack, assign delivery partner, deliver with OTP on the delivery app, confirm GPS appears only while delivering
- [ ] Cancel and return flows release/quarantine stock; refund needs a second person to approve
- [ ] Reports for one store and "All stores" agree; Excel download opens
- [ ] Install the PWA from Chrome on Android ("Add to Home screen")

## Payments go-live (PhonePe)

1. Complete PhonePe for Business merchant onboarding with the company's bank account, PAN, GST and pharmacy licences.
2. PhonePe issues credentials for the Standard Checkout API. For the current OAuth API put `PHONEPE_API_VERSION=v2`, `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET`, `PHONEPE_CLIENT_VERSION` in `backend/.env`. (Older salt-key accounts: `PHONEPE_API_VERSION=v1`, `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX`.)
3. In the PhonePe dashboard set the webhook URL `https://<api>/api/payments/phonepe/callback` with a username/password, and copy them to `PHONEPE_WEBHOOK_USERNAME` / `PHONEPE_WEBHOOK_PASSWORD`.
4. Test end to end with `PHONEPE_ENV=UAT` (sandbox) – successful, failed and abandoned payments – then switch to `PROD`.
5. Admin → Settings → Payments: tick "Show PhonePe online payment at checkout".
6. Confirm every URL and field name against https://developer.phonepe.com at go-live; all PhonePe code is isolated in `backend/src/services/phonepe.js`.
7. UPI ID / QR for the counter: enter the bank-verified UPI ID and upload the QR in Settings → Payments, and tick "verified" only after a ₹1 test payment reaches the company account.

Orders are marked paid only after the server-to-server status check succeeds for the exact amount. Staff can also verify a bank/UPI credit manually with the UTR reference (never from a screenshot).

## WhatsApp Business Platform go-live

1. Meta Business Manager → verify the business → WhatsApp → add the number 9264289295 (it must not be active on the normal WhatsApp app at the same time).
2. Create a permanent system-user access token. Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, choose any `WHATSAPP_VERIFY_TOKEN`.
3. Webhook URL: `https://<api>/api/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`.
4. Get message templates approved for order updates and delivery OTPs – business-initiated messages outside the 24-hour customer window need approved templates (the current code sends plain text, which works only inside that window; add template sending before relying on it for notifications).
5. Until all this is done, the site shows the click-to-chat link and staff handle WhatsApp photos manually via Medicine requests.

## Backups and data retention

- Atlas paid tiers: enable continuous backups. Self-managed: nightly `mongodump --uri "$MONGODB_URI" --out /backups/$(date +%F)` plus copying `UPLOAD_DIR` to off-site storage.
- Delivery GPS points are deleted automatically after `LOCATION_RETENTION_DAYS` (default 7). Notifications expire after 180 days.
- Keep prescriptions, invoices and purchase records for the period required by drug and tax law (see COMPLIANCE.md).
