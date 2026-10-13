# WorkLife Calendar for Obsidian

> **Forget the chaos.** A smart calendar, task tracker, time tracking, habit control, and finances — all in one beautiful and connected space.

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Obsidian](https://img.shields.io/badge/Obsidian-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)
[![UI: Svelte](https://img.shields.io/badge/UI-Svelte-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

[**Русский README**](https://github.com/AtinsS/WorkLife-Calendar-for-Obsidian/blob/master/README.RU.md)

![WorkLife Calendar](image-2.png)

## 💡 Why This Plugin Exists

Many workflows share the same problem: tasks live in one place, the calendar in another, time tracking in a third, and finances and reports are assembled manually in spreadsheets. As a result, the same data has to be entered several times.

**This plugin solves exactly that problem.** It doesn't just add another calendar or tracker. It connects planning, execution, and analysis into a single system:

- One task affects the calendar.
- The calendar affects time tracking.
- Time affects income calculation.
- Income generates automatic analytics.

---

## 🚀 Who This Is For

- **Freelancers and developers** who want to automatically calculate the cost of their work by the hour.
- **Students and researchers** who need to keep deadlines, projects, and daily habits in mind.
- **Anyone who is tired** of a dozen scattered apps and wants to bring order into a single Obsidian window.

---

## ✨ What's Inside

| Block | What You Get |
| :--- | :--- |
| **📅 Schedule** | Day / week / month calendar, Drag & Drop, weather in the grid |
| **✅ Tasks** | Quick natural-language adding, kanban, repeats, live timer |
| **⏱ Time & Income** | Work timer → hours × rate → automatic earnings |
| **⚖️ Habits & Health** | Habit tracker with streaks, weight graph |
| **💰 Finances** | Budget plan, savings jar, income, expenses, MD / Excel summaries |
| **📊 Analytics** | Charts by projects, income, and habits |
| **🤖 Local AI (Ollama)** | Task extraction, summaries, expense breakdown, workout plans |
| **🔔 Notifications** | Desktop reminders + phone push via ntfy.sh |

---

## 📦 Installation

### Community Plugins (recommended)

1. Open **Settings → Community Plugins** in Obsidian.
2. Click **Browse** and search for **WorkLife Calendar**.
3. Click **Install**, then **Enable**.

### Via BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Open BRAT settings → **Add Beta Plugin**.
3. Paste the link: `https://github.com/AtinsS/WorkLife-Calendar-for-Obsidian`
4. Click **Add Plugin**.

### Manually

1. Download the release archive or clone the repository.
2. Copy `main.js`, `manifest.json`, and `styles.css`.
3. Place them in the `.obsidian/plugins/worklife-calendar/` folder (create it if it doesn't exist).
4. Enable the plugin in *Settings → Community Plugins*.

> [!NOTE]
> Requires Obsidian **1.13.0+**. Works on desktop and mobile devices (AI — desktop only).

---

## 🧭 Quick Start

1. **Tasks** — open *Tasks* or click **"Quick add task"** and write as you would: *"submit report on Friday @Work !urgent"*.
2. **Finances** — the *Finances* section: tabs **Budget / Savings / Income / Expenses**. Add your first expense on the "Expenses" tab.
3. **Summary** — at the end of the month, select **Markdown** or **Excel** and click **"Summary"** — get a ready-made report.

> [!TIP]
> Configure **Finances → Currency Symbol** and **Summary Folder** — it takes a minute and immediately brings order to your reports.

---

## ☕ Support

If the plugin saves you time and helps with your work, you can support development:

- ⭐ Star the repository.
- [☕ Buy the author a coffee and a bun](https://boosty.to/atins/donate).

---

<details>
<summary><h3>✨ Detailed Features (expand)</h3></summary>

## 📅 Smart Planning

- Understands human language. Just write: *"! tomorrow 14:00 submit project @Work"* — and the plugin will set the date, time, project, and priority itself.
- AI helps create multiple tasks from a single prompt.
- Visual calendar (day / week / month) with Drag & Drop. Drag a task with your mouse to change its time.
- Weather right in the calendar grid helps you plan days more conveniently.

## ✅ Focus & Task Management

- Kanban board and lists: 5 statuses (To Do → In Progress → On Hold → Done → Not Completed).
- Live timer: start time tracking right from the task card. The timer won't reset when Obsidian restarts. (The timer starts when a task moves to the **"In Progress"** status; can be disabled in settings.)
- Recurring tasks: set it once — daily, weekly, or monthly.
- Move overdue tasks to the next day (can be disabled).
- Work tasks with hourly or daily rates — earnings are calculated automatically.

## ⚖️ Balance: Habits & Health

- Habit tracker with progress charts and "streaks" (completion series).
- Weight control: daily entry and a clear graph of progress toward your goal.

## 💰 Finances

A single **Finances** block with four tabs — plan and actual are kept separate:

| Tab | What's Inside |
| :--- | :--- |
| **Budget** | Monthly plan (approximate figures only): planned income, where to allocate, "where to save", rules. **Does not affect** actuals |
| **Savings** | Savings goals; deposits — actual expenses |
| **Income** | Earnings from tasks (hours × rate or daily rate), additional income sources, categories |
| **Expenses** | Actual spending, categories, text-based expense list breakdown (manually or via AI), contributions to savings |

**What else it can do:**

- **Automatic income calculation** — time from the timer × your hourly or daily rate.
- **Monthly summary** — a dropdown **Markdown / Excel** + **"Summary"** button:
  - **Markdown** — a note with totals, expenses by category, savings contributions;
  - **Excel (.xls)** — 7 sheets: summary, income, expenses, by category, by day, savings, budget plan; with AI advice enabled — a "Advice" sheet.
- **Currency** — symbol is chosen in settings: ₽, $, €, £, ₸, ₴, ₺, ¥, ₮, ₾, ₿, or custom text.
- **Analytics dashboard** — charts by projects, income, and habits.

## 🤖 Local AI (Ollama)

Runs entirely on your computer — data never leaves it.

> [!IMPORTANT] Requirements
> You need [Ollama](https://ollama.com) and at least one model. For example: `ollama pull llama3.1` or `ollama pull qwen2.5:7b`.

**What it can do:**

- **Tasks** — extract tasks from a note (right-click on a `.md` file), break a task into subtasks, generate a description, smart input ("Create several tasks named 'Call', repeat every Thursday, project 'Work'").
- **Notes** — summary of a folder or selected notes.
- **Schedule** — summary for a period and workload assessment.
- **Finances** — expense breakdown from text, budget forecast, allocation rules, advice in MD/Excel summary.
- **Workout plan** — questionnaire → plan → tasks and workout streak. No equipment — bodyweight only; static exercises (plank, etc.) always include hold time.

### Summary Styles

| Style | Format | When to Use |
| :--- | :--- | :--- |
| **Brief** | Heading + 2–4 sentences covering everything in one flow | Quickly refresh your memory on what the collection is about |
| **Detailed** | Overview → Key Ideas → Conclusions (bullet points) | Main format: to understand the material |
| **Bullet Points** | Bulleted list only, no prose | Skimming, getting into a topic |
| **For Management** | Essence → Facts & Figures → Risks & Questions | Report for a meeting, status, forwarding to management |

All styles produce **one common summary** across all notes at once, without "per-file" sections. Names, dates, and figures are preserved. The **"Additional Instructions"** field is appended to the prompt: for example, "highlight only actions and dates".

### Models: One or Two

- **One — for everything** — simple option, everything through one model.
- **Two — by role** — **main** (summaries, forecasts, advice, workout plans) and **for parsing** (expenses, quick input, subtasks). You can set a fast small model for parsing — responses will come faster.

### Privacy

- Requests go only to your Ollama (`localhost:11434`).
- Only the **text of the specific action** is sent to the model (note for summary, task title, amounts for advice).
- Passwords, tokens, and sync settings are **not transmitted**.
- ⚠️ The address field also accepts a cloud endpoint — in that case, data will go to an external server. For personal data, use only `localhost`.
- On mobile, AI is hidden; it works on desktop only.

**Settings:** *Settings → AI (Ollama)* — enable, address, models, action toggles, privacy.

## 🔔 Notifications That Won't Let You Oversleep

- Desktop reminders N minutes before start.
- Duplication to your phone (via ntfy.sh) so you know about a deadline even if Obsidian is closed.

</details>

<details>
<summary><h3>🔗 Sync & Integrations (expand)</h3></summary>

### Data Storage Format

The plugin stores data in JSON format in the `calendar-data/` folder at the vault root. When the **"Sync to vault root"** feature is enabled, it becomes the primary data storage format, providing fast loading and synchronization via:
- **Obsidian Sync** / **Remotely Save***
- **Syncthing**

> [!WARNING] Financial Data
> If you track finances in the plugin and use cloud synchronization, income and expense data will be stored in plain text in the cloud. It is recommended to use abstract project names or exclude the `calendar-data/` folder from synchronization.

### External Calendars (Google Calendar and others)

1. Create a [GitHub Personal Access Token](https://github.com/settings/tokens) (classic) with the `gist` scope.
2. Paste the token into the plugin settings and click **"Sync"**.
3. The plugin will create a Gist with an `.ics` file and provide a link.
4. Add this link to your calendar via the "Subscribe by URL" feature.

Optionally, **auto-sync** — the Gist updates when tasks change.

</details>

<details>
<summary><h3>🔔 Notifications (expand)</h3></summary>

The plugin has a built-in notification system so you don't miss anything important.

| Type | When It Triggers |
| :--- | :--- |
| **Local (browser)** | N minutes before start, when overdue, when time limit is exceeded, on the deadline day. |
| **To smartphone (ntfy.sh)** | Duplicates notifications to your phone. Works even when Obsidian is closed. |

### Setting Up ntfy.sh

An easy way to get notifications on your phone:

1. Install the [ntfy.sh](https://ntfy.sh/) app on your phone.
2. In the plugin settings, enable **ntfy.sh** and set a topic.
3. Subscribe to that topic in the app.

Also available: **delayed push** (queued when Obsidian opens — arrive on time even if it's closed) and **daily digest**.

> [!CAUTION] Security
> Use a unique topic (for example, a generated UUID like `a7f9b2c4-8e1d-4f3a-9c5b-2d6e8f0a1b3c`) so no one else can subscribe to your notifications. The plugin sends only triggers ("Overdue: Task Name"), not financial data or full texts.

</details>

<details>
<summary><h3>🧭 Widgets in Notes (expand)</h3></summary>

### Dashboard

Insert a code block into any note — get a widget panel (tasks / habits / goals):

````markdown
```dashboard
```
````

Or right-click on the page → **"Insert dashboard"**.

Dashboard widgets (tasks / habits / goals) are configured in *Settings → Dashboard*.

### Greeting

Insert a greeting with quick navigation, note search, and weight input:

````markdown
```hello
```
````

Or right-click on the page → **"Insert greeting"**.

In the greeting, you can show quick weight input and note search — both toggled in *Settings → Dashboard → Greeting Buttons*. The order of navigation buttons is configurable.

</details>

---

## 🐛 Issues & Bug Reports

Found a bug or have a feature suggestion? Open an issue on GitHub:

**[Open Issue](https://github.com/AtinsS/WorkLife-Calendar-for-Obsidian/issues)**

When reporting a bug, please include:

- Obsidian version
- Plugin version
- Steps to reproduce
- Expected and actual behavior
- Console errors (if any): *Ctrl+Shift+I → Console tab*

---

## Credits & License

The project is based on [obsidian-calendar-plugin](https://github.com/liamcain/obsidian-calendar-plugin) by [Liam Cain](https://github.com/liamcain) (MIT) and significantly extended.

Third-party libraries included in `main.js` are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<div align="center">
  <sub>Crafted with attention to detail for the Obsidian community</sub><br>
  <sub>Author: <a href="https://github.com/AtinsS">@AtinsS</a></sub><br>
  <sub>License: <a href="https://opensource.org/licenses/MIT">MIT</a></sub>
</div>