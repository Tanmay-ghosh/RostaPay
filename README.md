# RostaPay

**Describe your pay rules and roster to Claude. RostaPay runs them exactly, every week.**

RostaPay is shift rostering and pay calculation for small Indian businesses with part-time staff: cafés, salons and clinics. The owner's own Claude does the thinking over MCP. It reads the pay policy, the staff list and their availability, and drafts rosters. RostaPay does everything else with plain code: it stores the data, checks rosters, collects the hours people actually worked, calculates pay line by line, and gives the owner and every worker their own login.

> **No AI inside.** There are no OpenAI, Anthropic or other AI keys anywhere in this app. The customer's Claude plan pays for the thinking. RostaPay only pays for hosting.

## Try it

| | Login |
|---|---|
| Owner (Brew & Bites Café, Koramangala) | `demo@rostapay.app` / `RostaPay@2026` |
| Staff (Ravi, barista) | phone `9000000001`, PIN `1234` |
| Other staff | phones `9000000002` to `9000000005`, PIN `1234` |

The owner can restore the demo data at any time from **Settings → Reset demo data**.

## Connect Claude (MCP)

1. Log in as the owner and open **Settings & Claude**. Copy your private MCP link, which looks like `https://<your-app>.onrender.com/mcp/<key>`.
2. In Claude, go to **Settings → Connectors → Add custom connector**. Name it *RostaPay*, paste the link and click **Add**. No sign-in is needed, because the link itself is the key.
3. In a chat, turn RostaPay on from the tools menu and try:
   - *"Here's my pay policy: ₹200/hr, ₹300/hr after 8 hours a day, ₹100 extra if a shift runs past 10pm, double pay on Diwali. Set it up in RostaPay and test a 10-hour shift."*
   - *"Make next week's roster in RostaPay. Weekdays need 2 people from 8am to 11pm, weekends 3. Ravi only does evenings."*
   - *"How much did I spend on staff last week, and who did the most overtime?"*

### MCP tools

| Tool | What it does |
|---|---|
| `get_business_overview` | Reads settings, coverage needs, staff and availability, pay rules and this week's summary |
| `update_business_settings` | Sets limits (max days per week, max hours per day, minimum rest) and the staff needed at each time |
| `upsert_staff` | Adds or updates staff, their availability and days off, and sets their login PINs |
| `set_pay_rules` | Saves a pay policy as structured rules (see below) |
| `test_pay` | Shows the line-by-line pay for any hypothetical shift, so Claude can check its rules |
| `create_roster` | Saves a week's roster as a draft and returns any rule violations |
| `get_roster` / `get_payouts` | Read a week's roster or its pay summary back |

## The pay rule engine (`server/lib/payEngine.js`)

Every rule has a **kind**, a **priority**, **conditions** (all must match) and an **effect**. Pay is calculated minute by minute from *approved* hours.

- **Kinds:**
  - `rate` sets the hourly rate; the highest priority wins.
  - `addon` adds a multiplier, an extra amount per hour, a flat amount per shift, a deduction, or a minimum-hours top-up. It can carry a weekly cap.
  - `override` replaces the rate and suppresses lower-priority rules, for example festival double pay.
  - `manual` is for things that can't be calculated from hours, such as a sales bonus. These are listed so nothing is silently dropped.
- **Conditions:** a time window (for example night hours), days of the week, specific dates, hours beyond N in a day, hours beyond N in a week, roles, specific staff, minimum shift length, plus a **JSON Logic** formula for anything unusual.

Example: ₹200/hr base, ₹300/hr after 8 hours, ₹100 for shifts running past 10pm, and 2× pay on Diwali.

| Shift | Pay |
|---|---|
| 10 hours on a Tuesday | 8×200 + 2×300 = **₹2,200** |
| 16:00 to 01:00 | 8×200 + 1×300 + 100 = **₹2,000** |
| 8 hours on Diwali | 8×400 = **₹3,200** |

These cases are covered by the tests (`npm test`).

## What each side can do

- **Owner:**
  - Weekly roster grid with drag-to-move, rule checks and a "Publish week" button.
  - Staff list with logins, availability and days off.
  - Pay rules, with a live rule tester.
  - Hours approval: approve, edit then approve, or reject.
  - Payouts: per-person breakdowns, manual adjustments, mark as paid, CSV export.
  - Approval of shift swaps.
  - Settings and the Claude connection.
- **Worker (mobile-first):**
  - My week.
  - Log my hours.
  - My pay, with the full breakdown and pending amounts.
  - Availability and days off.
  - Request or accept shift swaps.

## Deploy (free, about 10 minutes)

1. Fork or push this repo to your GitHub account.
2. On [render.com](https://render.com), choose **New → Blueprint**, pick the repo and click **Apply**. `render.yaml` creates the web app and a free PostgreSQL database.
3. Wait for the first deploy to finish. The demo café is seeded automatically.

## Run locally

```bash
npm install
# needs PostgreSQL; set DATABASE_URL (default postgres://postgres@localhost:5432/rostapay)
npm run build && npm start        # http://localhost:3000
npm test                          # pay engine + roster check tests
```

Stack: Node 22, Express 5, PostgreSQL, React 19 + Vite, MCP TypeScript SDK (Streamable HTTP, stateless).
