# TLE Portal — The Lettings Expert

Partner portal + owner business dashboard for **The Lettings Expert** (TLE).

- **Agents (partners)** sign in and see *their* numbers: REX funnel and conversion
  rates, live Meta ads figures, lead → market-appraisal conversion — and set
  monthly forecasts (GCI, move-ins, MAs) that are measured against actuals with a
  predicted month-end run rate.
- **Susan (owner/MD)** gets the admin dashboard: every agent's forecast rolled up
  live ("10 agents × £10k ⇒ £100k expected"), predicted current rate, plus every
  business figure from the Base44 dashboard — move-ins, income, P&L, portfolio,
  arrears, compliance — practical and functional, with a one-click **Present**
  mode for the office TV.

Built with Next.js (App Router), TypeScript and Tailwind CSS v4. No chart or UI
libraries — charts are hand-rolled SVG. Replaces the Base44 prototype at
`tle-business-dashboard.base44.app`.

---

## Where every figure comes from — the stat badges

Every stat in the UI carries a small source badge so live and snapshot figures
can be told apart and worked through one by one:

| Badge | Meaning |
| --- | --- |
| 🟢 **LIVE** | Pulled live from REX CRM or Meta (Facebook/Instagram) right now. |
| 🟠 **MANUAL** | Keyed in by the admin as a manual override (admin → click-to-edit cells / actuals). |
| ⬜ **SNAPSHOT · 11 Jul** | We couldn't match a live stat for this yet — figure is from the TLE Business Dashboard snapshot captured 11 Jul 2026. Hover for the note. |
| 🔷 **DERIVED** | Computed from other stats (e.g. conversion %); inherits the weakest source involved. |

Resolution precedence is always **live → manual → snapshot** (`lib/stats.ts`).
The portal renders fully with **zero** environment variables set — everything
falls back to the snapshot so it demos offline.

### Figures we couldn't match live yet (worklist)

- **REX funnel per agent** — best-effort endpoint discovery is in place
  (`lib/rex-stats.ts`, see `/admin` → Diagnostics); anything unconfirmed falls
  back to snapshot.
- **PayProp** (portfolio, rent roll, arrears) — **no API access yet**. Sections
  render the snapshot with a "PayProp — awaiting access" tag.
- **GoHighLevel** (paid-leads funnel) — **no API access yet**. Snapshot + tag.
- **P&L source figures** — the Base44 P&L tab is password-protected and was not
  captured. The admin P&L page uses the H2 reforecast structure + manual entry.

---

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
```

No env vars are required to run locally — users/forecasts persist as JSON files
under `./data/` (gitignored) and every stat falls back to the snapshot.

To exercise the integrations locally, copy `.env.example` → `.env.local` and
fill in the values (see the variables table below).

```bash
npm run build && npm start   # production build check
```

---

## Deploying to Railway

1. **Push to GitHub** — create a new private repo (e.g. `tle-portal`) and push
   this project. Keep it separate from TEG PAID ADS.
2. **Create the Railway service** — New Project → *Deploy from GitHub repo* →
   pick the repo. The build is standard Next.js (`npm run build`, standalone
   output); Railway detects it automatically.
3. **Persistence — pick ONE:**
   - **Postgres (recommended):** add a Railway Postgres plugin to the project
     and set `DATABASE_URL` on the service (Railway can reference the plugin's
     variable). Tables are created automatically on first use.
   - **Volume:** attach a Railway Volume mounted at `/data` and set
     `DATA_DIR=/data`. Without one of these, Railway's filesystem is ephemeral
     and **accounts are wiped on every deploy**.
4. **Set the variables** (service → Variables):

| Variable | Required | Value / where to get it |
| --- | --- | --- |
| `AUTH_SECRET` | ✅ | Any long random string (session-token signing key). Generate fresh — do not reuse TEG's. |
| `ADMIN_EMAILS` | ✅ | **Susan's real email address** (comma-separate to add more, e.g. James's for rollout testing). Admin is locked to these addresses only. |
| `DATABASE_URL` | one of | Railway Postgres connection string (step 3). |
| `DATA_DIR` | one of | `/data` if using a Volume instead of Postgres. |
| `REX_API_BASE` | for REX | `https://api.uk.rexsoftware.com` |
| `REX_API_EMAIL` | for REX | **Copy from the TEG Railway project** (`REX_API_EMAIL`). |
| `REX_API_PASSWORD` | for REX | **Copy from the TEG Railway project** (`REX_API_PASSWORD`). |
| `REX_ACCOUNT_ID` | for REX | TLE shares the Property/Lettings REX account — **copy the value of `REX_ACCOUNT_LETTINGS` from the TEG Railway project**. |
| `META_SYSTEM_TOKEN` | for Meta | Same System User token as TEG — **copy from the TEG Railway project**. |
| `META_APP_SECRET` | for Meta | **Copy from the TEG Railway project** — every Graph call is signed with `appsecret_proof`. |
| `META_AD_ACCOUNT_LETTINGS` | for Meta | TLE ad account id (`act_…`). Not yet set in TEG either — wire when known. |
| `META_PAGE_LETTINGS` | later | TLE Facebook page id — needed for leadgen retrieval later. |

Missing integration variables never break the app — the affected stats simply
fall back to SNAPSHOT and the Diagnostics tab shows what's unconfigured.

5. **Verify** — open the deployed URL, `GET /api/health` returns `{ ok: true }`,
   sign up with a TLE email, then check `/admin` with Susan's account.

---

## Admin setup (Susan)

1. Set `ADMIN_EMAILS` to Susan's email address (step 4 above).
2. Susan creates a normal account via **Create account** with that exact
   address (allowed domains: `thelettingexperts.co.uk`, `lettingexperts.co.uk`,
   `theexpertsgroup.co.uk`).
3. The small **Admin** link in the page footer now opens the business
   dashboard for her; everyone else sees "This area is locked to the business
   owner."

## Linking an agent to their data

New accounts self-serve via signup (domain-gated). To connect an account to its
live data, open **Admin → Agents**, click the agent, and set:

- **agentKey** — roster slug (e.g. `rhiannon-dodge`) that ties the account to
  seed/snapshot rows (move-ins, pipeline, net income, portfolio, compliance).
  Auto-linked at signup when the name matches the roster; set manually otherwise.
- **rexUserId** — their REX AccountUsers id (the admin panel can look this up
  by email once REX credentials are configured). Enables live REX funnel stats.
- **metaCampaignId** — the Meta campaign id their ads run under (comma-separate
  multiple). Enables the live ads strip, spend, leads and CPL.

Password resets: Admin → Agents → agent → **Reset password** issues a one-time
temporary password to pass on.

## Integrations pending access

| System | Feeds | Status |
| --- | --- | --- |
| REX CRM | Agent funnel, compliance | Attempting live — endpoint discovery, snapshot fallback |
| Meta Graph API | Ads spend / leads / CPL | Live once tokens + ad account set |
| PayProp | Portfolio, rent roll, arrears | **No access yet** — snapshot only |
| GoHighLevel | Paid-leads funnel | **No access yet** — snapshot only |

When PayProp/GHL access lands, a future `lib/payprop.ts` / `lib/ghl.ts` slots
into the same `resolveStat` chain and the badges flip from SNAPSHOT to LIVE —
no UI changes needed.
