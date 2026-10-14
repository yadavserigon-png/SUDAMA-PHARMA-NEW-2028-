# Windows setup (PowerShell + VS Code)

Everything here refers **only** to the new project folder `sudama-pharma-platform`. Do not run any of these commands inside your old `sudama-pharma-2028` folder. Before every command, check that PowerShell shows the new folder in its prompt (step 1 shows how).

## 0. Install the tools (one time)

| Tool | Version | Download |
|---|---|---|
| Node.js | 22 LTS (includes npm) | https://nodejs.org |
| MongoDB Community Server | 7.x (or 6.x/8.x) – needs 5.0+ | https://www.mongodb.com/try/download/community (tick "Install MongoDB as a Service" and "MongoDB Compass") |
| Git | latest | https://git-scm.com/download/win |
| VS Code | latest | https://code.visualstudio.com |

Check in a new PowerShell window:

```powershell
node -v      # v22.x
npm -v
git --version
mongod --version   # if "not recognized", MongoDB is still fine when running as a Windows service
```

If PowerShell blocks `npm` scripts with an "execution policy" error, run once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## 1. Create the new folder and unzip

```powershell
New-Item -ItemType Directory -Force -Path C:\Projects | Out-Null
Expand-Archive -Path "$HOME\Downloads\sudama-pharma-platform.zip" -DestinationPath C:\Projects -Force
Set-Location C:\Projects\sudama-pharma-platform
Get-Location        # must end with \sudama-pharma-platform
code .              # opens the project in VS Code
```

## 2. Install dependencies

```powershell
Set-Location C:\Projects\sudama-pharma-platform
npm run install:all          # installs backend\ and frontend\ packages
```

## 3. Configure the frontend

Nothing is required for local development: the website calls `/api`, and Vite forwards it to `http://localhost:5000`.
For production builds only:

```powershell
Copy-Item frontend\.env.example frontend\.env
# then set VITE_API_URL=https://<your-api-domain>
```

## 4. Configure the backend

```powershell
Copy-Item backend\.env.example backend\.env
# generate two random secrets:
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('SETUP_TOKEN=' + require('crypto').randomBytes(16).toString('hex'))"
notepad backend\.env
```

Paste the two generated lines into `backend\.env`. Keep `MONGODB_URI=mongodb://127.0.0.1:27017/sudama_pharma_platform` for a local database. Never commit `.env` (it is already in `.gitignore`).

## 5. Create the MongoDB database

MongoDB creates the database `sudama_pharma_platform` automatically on first write; it is separate from any other database you have. To prepare it:

```powershell
Set-Location C:\Projects\sudama-pharma-platform\backend
npm run seed:base      # creates the standard pharmacy category tree (no medicine data is invented)
npm run init:admin     # creates the Super Admin; you type the password, it is hashed with bcrypt
```

`init:admin` suggests mobile **9264289295** and email **niteshkumar3850022@gmail.com** – press Enter to accept, then choose a strong password.
(Alternative: open http://localhost:5173/setup in the browser and use the `SETUP_TOKEN`. After setup, remove `SETUP_TOKEN` from `.env`.)

Using MongoDB Atlas instead of a local install: create a free cluster, add a database user, allow your IP, and set
`MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/sudama_pharma_platform?retryWrites=true&w=majority`.

## 6. Environment variables (summary)

| Variable | Needed for | Example |
|---|---|---|
| `MONGODB_URI` | always | `mongodb://127.0.0.1:27017/sudama_pharma_platform` |
| `JWT_SECRET` | always (64+ random chars) | generated in step 4 |
| `SETUP_TOKEN` | only for browser setup page | generated in step 4 |
| `CORS_ORIGIN`, `APP_BASE_URL`, `API_BASE_URL` | production URLs | `https://sudamapharma.in` |
| `PHONEPE_*` | online payments, after onboarding | see DEPLOYMENT.md |
| `WHATSAPP_*` | WhatsApp Business API, after Meta verification | see DEPLOYMENT.md |
| `MESSAGING_WEBHOOK_URL` | OTP / reset codes by SMS or email | your SMS provider relay |

## 7. Start both applications

```powershell
Set-Location C:\Projects\sudama-pharma-platform
npm run dev
```

- API: http://localhost:5000/api/health
- Website: http://localhost:5173
- Admin: http://localhost:5173/admin · POS: http://localhost:5173/pos · Delivery app: http://localhost:5173/delivery

Or in VS Code: **Terminal → Run Task → Run Sudama Pharma (both)**.

First steps after login: Admin → **Stores** (add Store 1, 2, 3 with map location and delivery radius) → **Users & roles** (staff per store) → **Products** / **Excel import** → **Inventory → Add stock** or **Purchases** → open **POS**.

## 8. Test the APIs

```powershell
Set-Location C:\Projects\sudama-pharma-platform\backend
npm test                                  # unit + integration tests (in-memory MongoDB)
Invoke-RestMethod http://localhost:5000/api/health
$login = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType 'application/json' -Body '{"identifier":"9264289295","password":"<your password>"}'
Invoke-RestMethod -Uri http://localhost:5000/api/stores -Headers @{ Authorization = "Bearer $($login.token)" }
```

## 9. Create a new Git repository (local)

```powershell
Set-Location C:\Projects\sudama-pharma-platform
git init
git branch -M main
git add .
git commit -m "Sudama Pharma platform - initial version"
git remote -v      # must print NOTHING yet - this repo is not connected to the old project
```

## 10. Create a separate GitHub repository

1. On github.com → **New repository** → name it e.g. `sudama-pharma-platform` (NOT `sudama-pharma-2028`), Private, no README.
2. Connect and push:

```powershell
git remote add origin https://github.com/<your-username>/sudama-pharma-platform.git
git remote -v      # double-check: the URL must be the NEW repository
git push -u origin main
```

Steps 11–15 (deploy frontend and backend, HTTPS, live testing, Android build) are in [DEPLOYMENT.md](DEPLOYMENT.md) and [ANDROID.md](ANDROID.md).

## Troubleshooting

| Problem | Fix |
|---|---|
| `MongooseServerSelectionError` | MongoDB service not running: `Get-Service MongoDB` / `Start-Service MongoDB`, or check the Atlas URI and IP allow-list |
| Port 5000 or 5173 busy | change `PORT` in `backend\.env`; for Vite run `npm run dev -- --port 5174` in `frontend` |
| Login says account locked | wait 15 minutes, or use Forgot password |
| Tests stuck on first run | `mongodb-memory-server` is downloading MongoDB once; allow it through the firewall |
| Camera scanner not opening | browsers allow the camera only on `localhost` or HTTPS |
