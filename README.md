# WorkLife Calendar for Obsidian

> **All-in-one:** smart calendar, task and habit tracker, time tracking, and financial planner — connected into a single ecosystem inside Obsidian.

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Obsidian](https://img.shields.io/badge/Obsidian-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)
[![UI: Svelte](https://img.shields.io/badge/UI-Svelte-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

![alt text](animate.gif)

[**Русский README**](https://github.com/AtinsS/WorkLife-Calendar-for-Obsidian/blob/master/README.RU.md)

## 💡 Why this plugin exists

Many workflows share the same problem: tasks live in one place, the calendar in another, time tracking in a third, and finances and reports are collected manually in spreadsheets. As a result, the same data has to be entered several times.

**This plugin solves exactly that problem.** It doesn't just add another calendar or tracker. It connects planning, execution, and analysis into one system:
- One task affects the calendar.
- The calendar affects time tracking.
- Time affects income calculation.
- Income generates automatic analytics.
- **Mobile experience:** working with tasks from your phone in Obsidian without unnecessary pain.

---

## 🚀 Who it's for

- **Freelancers and developers** who need to calculate the cost of work by rate.
- **Designers and consultants** managing several projects simultaneously.
- **Students and researchers** who need to link deadlines, habits, and productivity.
- **Automation enthusiasts** who want the system to work for them (notifications, reports).

---

## ⚙️ Main Workflow

```text
Project 
  ↓
Task (with time estimate and rate)
  ↓
Calendar / Schedule (slot planning)
  ↓
Time tracking (actual vs planned)
  ↓
Income and expenses (auto-calculation)
  ↓
Analytics (charts and reports)
```

---

## 📦 Installation

### Via BRAT (Recommended)
1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Open BRAT settings → **Add Beta Plugin**.
3. Paste the link: `https://github.com/AtinsS/obsidian-calendar-plugin-remastered`
4. Click **Add Plugin**.

### Manually
1. Download the archive or clone the repository.
2. Copy `main.js`, `manifest.json`, and `styles.css`.
3. Place them into the folder `.obsidian/plugins/calendar-plugin-remastered/` (create it if it doesn't exist).
4. Enable the plugin in *Settings → Community plugins*.

---

## ☕ Support

If the plugin saves your time and helps with your work, you can support the development:
- ⭐ Star the repository.
- [☕ Buy the author a coffee with a bun](https://boosty.to/atins/donate).

---

<details>
<summary><h3>✨ Detailed Features (expand)</h3></summary>

# 📅 Calendar & Schedule
- Day / week / month view on **FullCalendar** with drag & drop.
- Task and habit indicators right in the calendar grid.
- Create tasks by click, change time by dragging.
- **Weather** for each day of the week (Open-Meteo, no API keys).
- Adaptive mobile schedule.

# ✅ Tasks & Time Management
- **4 statuses:** To Do → In Progress → On Hold → Done.
- **Quick add** — `Ctrl+Alt+N` from anywhere. Natural language parsing with color highlighting:
  - Project: `@Work 14-15 meeting`
  - Time: `14:00 buy milk`, `14-15 meeting`, `from 16:00 to 18:00 call`
  - Date: `tomorrow buy milk`, `friday report`, `25.07 meeting`, `+3 task`
  - Priority: `! urgent`, `~ medium`, `- low`
  - Date and time in any position: `tomorrow at 14:00 buy milk`
  - `Enter` → advanced editor with prefilled data.
- **Kanban board** — 4 columns, drag & drop between them, create tasks in the "To Do" column.
  - Cards: project color, time, deadline, priority, work-task badge, recurrence, note link, live timer.
  - Filters: Today / All / Specific date / Project.
  - Right-click context menu.
- **Recurring tasks:** daily / weekly / monthly with custom interval.
- **Projects:** grouping with color labels.
- **Timer:** time tracking with auto-resume on Obsidian restart, live timer on cards.
- **Checklists** for each task.
- **Deadlines & estimates:** planned vs actual, deadline notifications.
- **Sync** with Tasks and Dataview plugins via `.md` files.

# 🔄 Habit Tracker
- Flexible frequency (days of week, day of month).
- Quantitative goals.
- Streaks and calendar indicators.
- **Display modes:** in task panel (default) / separate tab / hidden. Setting: General → "Habits mode".
- **Full CRUD** from habit panel and dashboard.

# 💰 Finance & Analytics
- **Income:** automatic by rate from work tasks, or manual entry.
- **Budget:** expense categories with icons and allocation rules.
- **Savings:** goals with progress percentage.
- **Analytics:** charts by project, income/expense dynamics by month, plan vs actual.

# 🎨 Appearance & UI
- Customizable accent color.
- Glassmorphism panels with background and transparency settings.
- **Info panel** below tabs (date, time, weather, tasks).
- **Dashboard** for notes, tasks and habits (create, edit, delete).

# 🌍 Localization
- **Russian and English**, switchable in settings.
- **System language** — auto-detect.
- **Week start:** Monday / Sunday / by language. Affects calendar, schedule, recurring tasks and habits.
- Everything translated: UI, settings, notifications, weather, analytics.

# ⛅ Weather
- **Weather tab** from the sidebar when a day is selected.
- **Weather in week view** — easier weekly planning.
- **Provider choice:** Open-Meteo, OpenWeatherMap, WeatherApi, Visual Crossing.

# 🤖 AI Task Extraction (Ollama)
- **Local AI** — extract tasks from `.md` notes using an Ollama model. No data leaves your machine.
- **Smart parsing** — understands weeks (`## Week 1`), days (`### Day 3`), headers, checkboxes, time estimates.
- **Project binding** for extracted tasks.
- **Time scheduling** — AI suggests start time; manual end-time editing; auto-schedule toggle.
- **Subtasks** — checkboxes become checklist items.
- **Right-click** on a `.md` file → "Extract tasks with AI".
- **Settings** — Ollama URL, model, context limit, connection test, live AI test.
- **Desktop only** — AI extraction is disabled on mobile.

</details>

<details>
<summary><h3>🔗 Synchronization and Integrations (expand)</h3></summary>

### New data storage format
The plugin can store data in JSON format in the `calendar-data/` folder at the vault root. When the "Sync to vault root" feature is enabled, it becomes the primary data storage format, providing fast loading and data synchronization via:
- **WebDAV** (Yandex.Disk, OneDrive, etc.)
- **Obsidian Sync** / **Remotely Save**
- **iCloud** / **Google Drive**
- **Syncthing**

> [!WARNING] Financial data
> If you keep financial records in the plugin and use cloud synchronization, income and expense data will be stored in plain text in the cloud. It is recommended to use abstract project names or exclude the `calendar-data/` folder from synchronization.

### External calendars (Git synchronization required)
1. Create a [GitHub Personal Access Token](https://github.com/settings/tokens) (classic) with the `gist` scope.
2. Paste the token into the plugin settings and click **"Sync"**.
3. The plugin will create a Gist with an `.ics` file and provide a link.
4. Add this link to your calendar via the "Subscribe by URL" feature.

### Tasks format integration (optional)
When the "Tasks plugin sync" setting is enabled, the plugin creates `.md` files for tasks so they are visible in the Tasks and Dataview plugins. This is an **additional** feature — the main storage remains in JSON. Example of a generated file:
```markdown
---
task_id: abc123
title: Buy milk
status: todo
date: day-2024-10-25
priority: medium
---
- [ ] Buy milk 📅 2024-10-25 🛫 14:30 🔼
```
*(Supported statuses: `- [ ]` todo, `- [/]` progress, `- [-]` paused, `- [x]` done)*

> [!NOTE]
> Optional synchronization with `.md` files (via the "Tasks plugin sync" setting) is intended for compatibility with the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) and [Dataview](https://github.com/blacksmithgu/obsidian-dataview) plugins.

</details>

<details>
<summary><h3>🔔 Notifications (expand)</h3></summary>

The plugin has a built-in notification system so you don't miss anything important.

| Type | When it triggers |
| :--- | :--- |
| **Local (browser)** | N minutes before start, on overdue, when time limit exceeded, on deadline day. |
| **To smartphone (ntfy.sh)** | Duplicate notifications to your phone. Works even when Obsidian is closed. |

### Setting up ntfy.sh

A simple way to receive notifications on your phone:
1. Install the [ntfy.sh](https://ntfy.sh/) app on your phone.
2. In the plugin settings, enable **ntfy.sh** and set a topic.
3. Subscribe to that topic in the app.

> [!CAUTION] Security
> Use a unique topic (e.g., a generated UUID like `a7f9b2c4-8e1d-4f3a-9c5b-2d6e8f0a1b3c`) so no one else can subscribe to your notifications. The plugin sends only triggers ("Overdue: Task name"), not financial data or full texts.

</details>

<details>
<summary><h3>🧭 UI Widgets in Notes (expand)</h3></summary>

Insert a code block into any note to create a quick navigation panel for the plugin sections:

````markdown
```calendar-nav
schedule:Schedule
tasks:Tasks
finance:Finance
analytics:Analytics
```
````
Available keys: `schedule`, `tasks`, `finance`, `analytics`.

**Style customization** (first line starts with `%`):
````markdown
```calendar-nav
%color:#fff;bg:#333;radius:20px;size:14px;accent:#5f99e1
schedule:Schedule
tasks:Tasks
```
````
Style parameters: `color` (text), `bg` (background), `radius` (border radius), `size` (font size), `accent` (hover color).

### Dashboard and greeting

Right-click on a page and select "Add Dashboard" or "Add greeting" to create a new dashboard or greeting on the page.
![alt text](image-2.png)

</details>

---

## 🐛 Issues and Bug Reports

Found a bug or have a feature suggestion? Open an issue on GitHub:

**[Open Issue](https://github.com/AtinsS/WorkLife-Calendar-for-Obsidian/issues)**

When reporting a bug, please include:
- Obsidian version
- Plugin version
- Steps to reproduce
- Expected and actual behavior
- Console errors (if any): *Ctrl+Shift+I → Console tab*

---

<div align="center">
  <sub>Developed with attention to detail for the Obsidian community</sub><br>
  <sub>Author: <a href="https://github.com/AtinsS">@AtinsS</a></sub><br>
  <sub>License: <a href="https://opensource.org/licenses/MIT">MIT</a></sub>
</div>