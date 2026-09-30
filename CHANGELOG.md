# Changelog

All notable changes to **WorkLife Calendar** are documented here.

## [2.22.0] — 2026-10-01

### Added
- **Budget Planning** (ex «Financial Distribution») — modern UI, tabs **Budget** / **Expenses**
- **Expense log** with full CRUD (create / edit / delete), date, category, totals
- **Expense categories** — built-in taxonomy (food, transport, clothing, health…) + user-defined categories with emoji
- **AI expense parsing** — free text → amounts & categories (Ollama + offline fallback)
- **AI forecast** — remainder / cash-flow outlook for the month
- **AI distribution rules** — suggested allocation rules and savings percents
- **Savings goal rollover** — incomplete goals (and money) carry to next months until fully funded; history is kept
- **Goal deposit / withdraw** this month by **amount or %** (deposit % of remainder, withdraw % of saved)
- **Savings goal on dashboard** — single goal shows its icon, name and «remaining»; multi-goal list when expanded
- **Finance analytics** tab renamed to **Finance** — income vs expense overview and breakdown by category
- **Morning ntfy digest** — now schedules **every day** (was once per app launch); safe against duplicate sends
- **Weight entry** — compact button next to note search opens a minimal modal with current weight
- **AI tools** grouped in the note context menu when more than one action is available

### Changed
- Dashboard goals / habits / tasks widgets aligned visually
- Note AI summary scanning effect (same language as task extraction)
- Realistic soft-glow sun in greeting weather layer
- Compact weather chip in Hello; weight no longer floats in the corner
- Scrollbars hidden across plugin views (scrolling still works)
- Expense inputs restored with proper rounded corners and select chevrons

### Fixed
- **Balance** subtracts only this month’s goal deposits (not the full carried-over total)
- **Duplicate last month** copies expense **amounts**, not empty shells; goals keep accumulated money
- Goal contribution math after month rollover (`broughtForward`)
- `getCurrentBalance` aligned with the budget remainder formula
- Daily digest dedupe keys no longer expire at 06:00 the same day
- Tab / category i18n keys resolved correctly (no raw key paths in UI)
- Habit cards keep rounded corners in analytics

### Technical
- `MonthGoal.broughtForward`, `FinanceMonthData.expenses`, custom expense category store
- `AIExpenseParseModal`, `AIFinanceModal`, `WeightEntryModal`, `financeAI` service
- Tests: **303** passing · lint clean · `main.js` production build

---

## Earlier releases

See [GitHub Releases](https://github.com/AtinsS/WorkLife-Calendar-for-Obsidian/releases) for 2.21.x and prior.
