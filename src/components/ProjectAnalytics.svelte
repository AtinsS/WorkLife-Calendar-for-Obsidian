<script lang="ts">
  import type { ITask, IProject } from "../task-tracker/types";
  import { tasks, projects, timeLogs } from "../task-tracker/stores";
  import { formatDuration } from "../task-tracker/TimerManager";
  import { t } from "../i18n";

  export let filter: ((t: ITask) => boolean) | undefined = undefined;

  interface ProjectData {
    projectId: string | null;
    projectName: string;
    projectColor: string;
    totalMs: number;
    taskCount: number;
    earnings: number;
  }

  $: filteredTasks = filter ? $tasks.filter(filter) : $tasks;
  $: projectStats = buildProjectStats($projects, filteredTasks, $timeLogs);

  function buildProjectStats(
    allProjects: IProject[],
    monthTasks: ITask[],
    allTimeLogs: { taskId: string; duration: number }[],
  ): ProjectData[] {
    const projectMap = new Map<string, ProjectData>();
    const noProjectKey = "__none__";

    // Fallback: sum time logs per task (in case totalWorkTime wasn't set on the task)
    const timeByTask = new Map<string, number>();
    for (const log of allTimeLogs) {
      timeByTask.set(log.taskId, (timeByTask.get(log.taskId) || 0) + log.duration);
    }

    for (const p of allProjects) {
      projectMap.set(p.id, {
        projectId: p.id,
        projectName: p.name,
        projectColor: p.color,
        totalMs: 0,
        taskCount: 0,
        earnings: 0,
      });
    }

    for (const task of monthTasks) {
      const pKey = task.projectId || noProjectKey;
      if (!projectMap.has(pKey)) {
        const proj = task.projectId ? allProjects.find((p) => p.id === task.projectId) : null;
        projectMap.set(pKey, {
          projectId: task.projectId,
          projectName: proj?.name || $t("projectAnalytics.noProject"),
          projectColor: proj?.color || "#647177",
          totalMs: 0,
          taskCount: 0,
          earnings: 0,
        });
      }
      const entry = projectMap.get(pKey);
      entry.taskCount++;

      // Time: actual (timer on task) > estimated (declared) > timer logs fallback
      let taskMs = 0;
      if (task.totalWorkTime && task.totalWorkTime > 0) {
        taskMs = task.totalWorkTime;
      } else if (task.estimatedTime && task.estimatedTime > 0) {
        taskMs = task.estimatedTime * 60000;
      } else {
        const logMs = timeByTask.get(task.id) || 0;
        if (logMs > 0) taskMs = logMs;
      }
      entry.totalMs += taskMs;

      if (task.isWorkTask && task.rate && task.status === "done") {
        let effectiveMs = 0;
        if (task.totalWorkTime && task.totalWorkTime > 0) {
          effectiveMs = task.totalWorkTime;
        } else if (task.estimatedTime && task.estimatedTime > 0) {
          effectiveMs = task.estimatedTime * 60000;
        } else {
          effectiveMs = timeByTask.get(task.id) || 0;
        }
        if (task.paymentType === "hour" && effectiveMs > 0) {
          const totalHours = effectiveMs / 3600000;
          const overtimeStart = task.overtimeStart || 0;
          const overtimeMultiplier = task.overtimeMultiplier || 1;
          if (overtimeStart > 0 && overtimeMultiplier > 1 && totalHours > overtimeStart) {
            const regularHours = overtimeStart;
            const overtimeHours = totalHours - overtimeStart;
            entry.earnings += Math.round(task.rate * (regularHours + overtimeHours * overtimeMultiplier));
          } else {
            entry.earnings += Math.round(task.rate * totalHours);
          }
        } else if (task.paymentType === "day") {
          entry.earnings += task.rate;
        }
      }
    }

    const result = Array.from(projectMap.values());
    result.sort((a, b) => b.totalMs - a.totalMs);
    return result;
  }

  $: totalMs = projectStats.reduce((sum, p) => sum + p.totalMs, 0);

  function getShare(ms: number): string {
    if (totalMs === 0) return "0%";
    return Math.round((ms / totalMs) * 100) + "%";
  }

  function formatTime(ms: number): string {
    return formatDuration(ms);
  }
</script>

<div class="project-table">
  <div class="project-table-header">
    <span class="pt-col-name">{$t("projectAnalytics.project")}</span>
    <span class="pt-col-time">{$t("projectAnalytics.time")}</span>
    <span class="pt-col-earnings">{$t("projectAnalytics.earnings")}</span>
    <span class="pt-col-share">{$t("projectAnalytics.share")}</span>
  </div>
  {#each projectStats as p (p.projectId || "__none__")}
    <div class="project-table-row">
      <span class="pt-col-name">
        <span class="pt-dot" style="background: {p.projectColor}"></span>
        {p.projectName}
      </span>
      <span class="pt-col-time">{formatTime(p.totalMs)}</span>
      <span class="pt-col-earnings">{p.earnings > 0 ? p.earnings.toLocaleString($t("locale.numberLocale")) + " " + $t("locale.currencySymbol") : "—"}</span>
      <span class="pt-col-share">{getShare(p.totalMs)}</span>
    </div>
  {/each}
</div>

<style>
  .project-table {
    width: 100%;
  }

  .project-table-header {
    display: grid;
    grid-template-columns: 1fr 90px 80px 60px;
    gap: 8px;
    padding: 6px 0;
    font-size: 10px;
    font-weight: 600;
    color: var(--mcp-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--mcp-glass-border);
  }

  .project-table-row {
    display: grid;
    grid-template-columns: 1fr 90px 80px 60px;
    gap: 8px;
    padding: 8px 0;
    align-items: center;
    font-size: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    animation: pt-row-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) backwards;
    transition: background 0.15s ease, transform 0.15s ease;
  }

  /* header is child 1; data rows start at 2 */
  .project-table-row:nth-child(2) { animation-delay: 0ms; }
  .project-table-row:nth-child(3) { animation-delay: 45ms; }
  .project-table-row:nth-child(4) { animation-delay: 90ms; }
  .project-table-row:nth-child(5) { animation-delay: 135ms; }
  .project-table-row:nth-child(6) { animation-delay: 180ms; }
  .project-table-row:nth-child(7) { animation-delay: 225ms; }
  .project-table-row:nth-child(8) { animation-delay: 270ms; }
  .project-table-row:nth-child(9) { animation-delay: 315ms; }

  .project-table-row:hover {
    background: rgba(255, 255, 255, 0.03);
    transform: translateX(2px);
  }

  @keyframes pt-row-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .pt-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 0 0 transparent;
    transition: box-shadow 0.2s ease, transform 0.2s ease;
  }

  .project-table-row:hover .pt-dot {
    transform: scale(1.25);
    box-shadow: 0 0 8px currentColor;
  }

  .project-table-row:last-child {
    border-bottom: none;
  }

  .pt-col-name {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--mcp-text-muted);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (prefers-reduced-motion: reduce) {
    .project-table-row {
      animation: none !important;
    }
  }

  .pt-col-time {
    text-align: right;
    font-weight: 600;
    color: var(--mcp-text-muted);
    font-size: 11px;
  }

  .pt-col-earnings {
    text-align: right;
    font-weight: 600;
    color: var(--mcp-success);
    font-size: 11px;
  }

  .pt-col-share {
    text-align: right;
    font-weight: 500;
    color: var(--mcp-text-faint);
    font-size: 11px;
  }

  @media (max-width: 768px) {
    .project-table-header,
    .project-table-row {
      grid-template-columns: 1fr 65px 60px 45px;
      gap: 4px;
      font-size: 11px;
    }
    .pt-col-name {
      white-space: normal;
      overflow: visible;
      text-overflow: unset;
    }
  }
</style>
