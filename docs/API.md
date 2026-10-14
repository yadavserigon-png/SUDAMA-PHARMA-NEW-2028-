# REST API overview

Base URL `/api`. JSON in/out. Auth: `Authorization: Bearer <token>` from `/api/auth/login`. Every store-bound endpoint accepts `storeId=<id>|all` and enforces the caller's store access on the server. Lists support `page` and `limit`.

| Area | Endpoints |
|---|---|
| Auth | `GET /auth/setup-status`, `POST /auth/setup`, `POST /auth/register`, `POST /auth/verify`, `POST /auth/login`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET/PUT /auth/me`, `POST /auth/change-password`, `POST /auth/logout-all`, `/auth/me/addresses` |
| Settings | `GET /settings/public`, `GET/PUT /settings/:key` (branding, policies, payments, inventory), `POST /settings/upload/image` |
| Stores | `GET /stores/public`, `GET /stores/serviceability?pincode=&lat=&lng=`, `GET/POST /stores`, `GET/PUT /stores/:id` |
| Users | `GET /users/meta/roles`, `GET/POST /users`, `GET/PUT /users/:id`, `PUT /users/:id/salary`, `POST /users/:id/reset-password`, `PUT /users/:id/delivery`, `PUT /users/:id/wholesale` |
| Catalogue | `GET/POST /categories`, `PUT /categories/:id`, `GET /products` (search), `GET /products/facets`, `GET /products/barcode/:code`, `GET/POST /products`, `PUT /products/:id`, `POST /products/:id/barcodes`, `POST /products/:id/images` |
| Inventory | `GET /inventory/batches`, `GET /inventory/stock`, `POST /inventory/stock-in`, `POST /inventory/batches/:id/adjust|status|inspect`, `GET /inventory/alerts/expiry`, `GET /inventory/alerts/low-stock`, `GET /inventory/movements`, `GET /inventory/valuation`, `GET /inventory/analysis`, `/inventory/counts` (+ `/:id`, `/:id/approve`) |
| Transfers | `GET/POST /transfers`, `POST /transfers/:id/dispatch|receive|cancel` |
| Purchasing | `GET/POST /suppliers`, `PUT /suppliers/:id`, `POST /purchases/calculate`, `GET/POST /purchases`, `GET/PUT /purchases/:id`, `POST /purchases/:id/receive|payments|cancel|invoice-file`, `POST /purchases/returns`, `GET /purchases/returns/list` |
| POS | `GET /pos/shift/current`, `POST /pos/shift/open|close`, `GET /pos/shifts`, `GET /pos/scan`, `GET /pos/search`, `POST /pos/sale`, `POST /pos/cash-refund`, `GET /pos/daily-report` |
| Orders | `POST /orders/quote`, `POST /orders/checkout`, `GET /orders/my`, `GET /orders/:id`, `POST /orders/:id/cancel|return-request`, `GET /orders/:id/invoice.pdf`, staff: `GET /orders`, `PATCH /orders/:id/status`, `POST /orders/:id/prescription-review|partial-fulfil|return` |
| Prescriptions & requests | `POST/GET /prescriptions`, `GET /prescriptions/mine`, `POST /prescriptions/:id/review`, `POST/GET /medicine-requests`, `GET /medicine-requests/mine`, `PUT /medicine-requests/:id`, `GET /files/:name` (authorised private files) |
| Payments & refunds | `POST /payments/phonepe/initiate`, `POST /payments/phonepe/callback`, `GET /payments/phonepe/status/:txn`, `POST /payments/manual-verify`, `GET /payments`, `GET /payments/reconciliation`, `GET/POST /refunds`, `GET /refunds/mine`, `POST /refunds/:id/approve|reject|process` |
| Delivery | partner: `GET /delivery/me`, `POST /delivery/me/online|documents`, `GET /delivery/me/assignments`, `POST /delivery/assignments/:id/accept|pickup|out|deliver|fail|return-to-store`, `POST /delivery/location`; manager: `GET /delivery/partners`, `POST /delivery/assign`, `GET /delivery/active`, `GET /delivery/assignments`, `POST /delivery/assignments/:id/settle-cod|incentive`, `GET /delivery/performance` |
| Marketing | `GET /coupons/offers`, `GET/POST /coupons`, `PUT /coupons/:id`, `GET /coupons/:id/redemptions`, `GET /ads/active`, `POST /ads/:id/impression|click`, `POST /ads/applications`, `GET /ads/mine`, `POST /ads`, `GET /ads`, `POST /ads/:id/review|invoice`, `GET /ads/applications/list`, `PUT /ads/applications/:id` |
| Wholesale | `POST /wholesale/register`, `GET /wholesale/me`, `POST /wholesale/me/documents`, `GET /wholesale/catalog`, `GET/POST /wholesale/quotations`, `POST /wholesale/quotations/:id/quote|accept`, `POST /wholesale/orders` |
| People | `POST /employees/attendance/check-in|check-out`, `GET/POST /employees/attendance`, `GET/POST /employees/leaves`, `POST /employees/leaves/:id/decision`, `GET/POST /employees/tasks`, `PUT /employees/tasks/:id`, `GET /employees/performance` |
| Money & reports | `GET/POST /expenses`, `PUT /expenses/:id`, `POST /expenses/:id/decision`, `GET /reports/dashboard`, `GET /reports/compare`, `GET /reports/download` |
| Support | `POST /support`, `GET /support/mine`, `GET /support`, `GET/PUT /support/:id`, `POST /support/:id/messages` |
| Import/export | `GET /io/types`, `GET /io/template/:type`, `POST /io/preview/:type`, `POST /io/commit/:type`, `GET /io/export/:type?format=csv` |
| WhatsApp | `GET /whatsapp/status`, `GET/POST /whatsapp/webhook`, `GET /whatsapp/threads`, `GET /whatsapp/threads/:phone`, `POST /whatsapp/send` |
| Other | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET /audit`, `GET /health` |
