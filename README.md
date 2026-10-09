# WorkLife Calendar for Obsidian

> **Say goodbye to chaos.** A smart calendar, task tracker, time tracking, habit tracking, and finance management — all in one beautiful, connected space.

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Obsidian](https://img.shields.io/badge/Obsidian-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)
[![UI: Svelte](https://img.shields.io/badge/UI-Svelte-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)


</div>

---

[**Русский README**](README.ru.md)

## 💡 Why this plugin exists

Many workflows share the same problem: tasks live in one place, the calendar in another, time tracking in a third, and finances and reports are assembled manually in spreadsheets. As a result, the same data has to be entered several times.

**This plugin solves exactly that problem.** It doesn't just add another calendar or tracker. It connects planning, execution, and analysis into a single system:
- One task affects the calendar.
- The calendar affects time tracking.
- Time affects income calculation.
- Income generates automatic analytics.

---

## 🚀 Who it's for

- **Freelancers and developers** who want to automatically calculate the value of their work by the hour.
- **Students and researchers** who need to keep track of deadlines, projects, and daily habits.
- **Anyone tired** of a dozen disconnected apps and who wants to get organized in a single Obsidian window.


---

## 📦 Installation

### Via BRAT (Recommended)
1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Open BRAT settings → **Add Beta Plugin**.
3. Paste the link: `https://github.com/AtinsS/WorkLife-Calendar-for-Obsidian`
4. Click **Add Plugin**.

### Manually
1. Download the archive or clone the repository.
2. Copy `main.js`, `manifest.json`, and `styles.css`.
3. Place them in the `.obsidian/plugins/worklife-calendar/` folder (create it if it doesn't exist).
4. Enable the plugin in *Settings → Community plugins*.

---

## 🧭 Quick start

1. **Tasks** — open *Tasks* or click "Quick add task" and write it as is: *"submit report on Friday @Work !urgent"*.
2. **Finance** — open the *Finance* section: **Income / Expenses / Budget** tabs. Add your first expense on the "Expenses" tab.
3. **Summary** — at the end of the month, click "📄 Summary to MD" — get a ready-made note with the results.

> [!TIP]
> Set up **Finance → Currency symbol** and **Folder for summaries** — it takes a minute and immediately brings order to your reports.

---

## ☕ Support

If the plugin saves you time and helps in your work, you can support the development:
- ⭐ Star the repository.
- [☕ Buy the author a coffee and a bun](https://boosty.to/atins/donate).

---

<details>
<summary><h3>✨ Detailed features (expand)</h3></summary>

# 📅 Smart planning
- Understands human language. Just write: *"tomorrow at 14:00 submit project @Work !urgent"* — and the plugin will set the date, time, project, and priority itself.
- AI helps create multiple tasks from a single prompt.
- Visual calendar (day/week/month) with Drag & Drop support. Drag a task with your mouse to change its time.
- Weather right in the calendar grid, so you can plan wisely.

# ✅ Focus and task management

- Kanban board and lists: 5 statuses (To do → In progress → On hold → Done → Not completed).
- Live timer: start time tracking right from the task card. When Obsidian restarts, the timer won't reset. (The timer starts when a task is in the "In progress" status)
- Recurring tasks: set it up once, and the plugin will create them daily, weekly, or monthly.

# ⚖️ Balance: Habits and Health

- Habit tracker with progress charts and "streaks".
- Weight tracking: daily input and a clear chart of progress toward the goal.

# 💰 Finance

A single **Finance** block with three tabs — everything about money in one place:

| Tab | What's inside |
| :--- | :--- |
| **Income** | Earnings from tasks (hours × rate or daily rate), additional income sources, categories |
| **Expenses** | Actual spending, expense categories, parsing a text list of expenses (manually or via AI) |
| **Budget** | Monthly plan: main account, savings goals, "where to set aside", distribution rules |

**What else it can do:**

- **Automatic income calculation** — time from the timer × your hourly or daily rate.
- **Monthly summary** — the "📄 Summary to MD" button creates a beautiful note: results, expenses by category with shares, goal progress, rules. Where to save it — configurable.
- **Currency** — the symbol is chosen in settings: ₽, $, €, £, ₸, ₴, ₺, ¥, ₮, ₾, ₿, or your own text.
- **Analytics dashboard** — charts for projects, income, and habits.

# 🤖 Local AI (Ollama)

Runs entirely on your computer — no data leaves it.

> [!IMPORTANT] Requirements
> You need [Ollama](https://ollama.com) and at least one model. For example: `ollama pull llama3.1` or `ollama pull qwen2.5:7b`.

**What it can do:**

- **Tasks** — extract tasks from a note (right-click on `.md`), break a task into subtasks, generate a description, smart input ("Create several tasks named 'Call', repeat every Thursday, project 'Work'").
- **Notes** — summarize a folder or selected notes.
- **Schedule** — summary for a period and workload assessment.
- **Finance** — parse expenses from text, budget forecast, distribution rules, tips in the MD summary.

### Summary styles

| Style | Format | When to use |
| :--- | :--- | :--- |
| **Brief** | Title + 2–4 sentences covering everything in one flow | Quickly refresh your memory on what the collection is about |
| **Detailed** | Overview → Key ideas → Conclusions (bullet points) | The main format: to understand the material |
| **Bullet points** | Only a bulleted list, no prose | Quick scan, getting into the topic |
| **For management** | Essence → Facts and figures → Risks and questions | A report for a meeting, status, forwarding to management |

All styles produce **one combined summary** across all notes at once, without per-file sections. Names, dates, and figures are preserved. The **"Additional instructions"** field is appended to the prompt: for example, "highlight only actions and dates".

### Models: one or two

- **One — for everything** — the simple option, everything through a single model.
- **Two — by role** — **main** (summaries, forecasts, tips) and **for parsing** (expenses, quick input, subtasks). You can use a fast small model for parsing — responses will come faster.

### Privacy

- Requests go only to your Ollama (`localhost:11434`).
- Only the **text of the specific action** is sent to the model (note for summarization, task title, amounts for tips).
- Passwords, tokens, and sync settings are **not transmitted**.
- ⚠️ The address field also accepts a cloud endpoint — in that case, data will go to an external server. For personal data, use only `localhost`.
- On mobile, AI is hidden — it works only on desktop.

**Settings:** *Settings → AI (Ollama)* — enable, address, models, action toggles, privacy.

# 🔔 Notifications that won't let you sleep through everything

- Desktop reminders N minutes before the start.
- Duplication to your phone (via ntfy.sh), so you know about a deadline even if Obsidian is closed.

</details>

<details>
<summary><h3>🔗 Sync and integrations (expand)</h3></summary>

### New data storage format
The plugin stores data in JSON format in the `calendar-data/` folder at the root of the vault. When the "Sync to vault root" feature is enabled, it becomes the primary data storage format, providing fast loading and data synchronization via:
- **WebDAV** (Yandex.Disk, OneDrive, etc.)
- **Obsidian Sync** / **Remotely Save**
- **iCloud** / **Google Drive**
- **Syncthing***


> [!WARNING] Financial data
> If you keep track of finances in the plugin and use cloud synchronization, income and expense data will be stored in plain text in the cloud. It is recommended to use abstract project names or exclude the `calendar-data/` folder from synchronization.

### External calendars (requires Git synchronization)
1. Create a [GitHub Personal Access Token](https://github.com/settings/tokens) (classic) with the `gist` scope.
2. Paste the token into the plugin settings and click **"Sync"**.
3. The plugin will create a Gist with an `.ics` file and provide a link.
4. Add this link to your calendar via the "Subscribe by URL" feature.

</details>

<details>
<summary><h3>🔔 Notifications (expand)</h3></summary>

The plugin has a built-in notification system so you don't miss anything important.

| Type | When it triggers |
| :--- | :--- |
| **Local (browser)** | N minutes before the start, when overdue, when the time limit is exceeded, on the deadline day. |
| **To smartphone (ntfy.sh)** | Duplicates notifications to your phone. Works even when Obsidian is closed. |

### Setting up ntfy.sh

A simple way to get notifications on your phone:
1. Install the [ntfy.sh](https://ntfy.sh/) app on your phone.
2. In the plugin settings, enable **ntfy.sh** and set a topic.
3. Subscribe to that topic in the app.

> [!CAUTION] Security
> Use a unique topic (for example, a generated UUID like `a7f9b2c4-8e1d-4f3a-9c5b-2d6e8f0a1b3c`) so that no one else can subscribe to your notifications. The plugin sends only triggers ("Overdue: Task name"), not financial data or full texts.

</details>

<details>
<summary><h3>🧭 UI Widgets in notes (expand)</h3></summary>

Insert a code block into any note to create a quick navigation panel for the plugin's sections:

````markdown
```calendar-nav
schedule:Schedule
tasks:Tasks
finance:Finance
analytics:Analytics
```
````
Available keys: `schedule`, `tasks`, `finance`, `analytics`.

**Style customization** (the first line starts with `%`):
````markdown
```calendar-nav
%color:#fff;bg:#333;radius:20px;size:14px;accent:#5f99e1
schedule:Schedule
tasks:Tasks
```
````
Style parameters: `color` (text), `bg` (background), `radius` (corner rounding), `size` (font size), `accent` (hover color).

### Dashboard and greeting

Right-click on a page and select "Add Dashboard" or "Insert greeting" to create a new dashboard or greeting on the page.

In the greeting, you can show quick weight input and note search — both toggled in *Dashboard → Greeting buttons*.
Dashboard widgets (tasks / habits / goals) are configured in *Dashboard → Dashboard widgets*.

</details>


---

## 🐛 Issues and bug reports

Found a bug or have a feature suggestion? Open an issue on GitHub:

**[Open an Issue](https://github.com/AtinsS/WorkLife-Calendar-for-Obsidian/issues)**

When reporting a bug, please include:
- Obsidian version
- Plugin version
- Steps to reproduce
- Expected and actual behavior
- Console errors (if any): *Ctrl+Shift+I → Console tab*

---

## Credits and license

The project is based on [obsidian-calendar-plugin](https://github.com/liamcain/obsidian-calendar-plugin) by [Liam Cain](https://github.com/liamcain) (MIT) and has been significantly extended.

Third-party libraries included in `main.js` are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<div align="center">
  <sub>Crafted with attention to detail for the Obsidian community</sub><br>
  <sub>Author: <a href="https://github.com/AtinsS">@AtinsS</a></sub><br>
  <sub>License: <a href="https://opensource.org/licenses/MIT">MIT</a></sub>
</div>