import { Notice, requestUrl } from "obsidian";
import type CalendarPlugin from "src/main";
import { tRaw } from "../i18n";
import { writable } from "svelte/store";

const REPO = "AtinsS/WorkLife-Calendar-for-Obsidian";
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const LAST_CHECK_KEY = "worklife-update-last-check";
const LAST_NOTIFIED_KEY = "worklife-update-notified";

/** Shared UI state: version of available update, or null when up to date. */
export const pluginUpdateInfo = writable<{ version: string | null }>({ version: null });

export interface ReleaseAssets {
  mainJs?: string;
  stylesCss?: string;
  manifestJson?: string;
}

export interface LatestRelease {
  version: string;
  url: string;
  notes: string;
  assets: ReleaseAssets;
}

/** Compare dotted versions (2.25.3 vs 2.25.2). Returns -1/0/1. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/i, "")
      .split(/[.\-+_]/)
      .map((p) => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const resp = await requestUrl({
    url: `https://api.github.com/repos/${REPO}/releases/latest`,
    method: "GET",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (resp.status < 200 || resp.status >= 300) return null;

  const data = resp.json as {
    tag_name?: string;
    html_url?: string;
    body?: string;
    prerelease?: boolean;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  if (!data.tag_name || data.prerelease) return null;

  const assets: ReleaseAssets = {};
  for (const a of data.assets || []) {
    const name = (a.name || "").toLowerCase();
    const url = a.browser_download_url;
    if (!url) continue;
    if (name === "main.js") assets.mainJs = url;
    else if (name === "styles.css") assets.stylesCss = url;
    else if (name === "manifest.json") assets.manifestJson = url;
  }

  return {
    version: data.tag_name.replace(/^v/i, ""),
    url: data.html_url || RELEASES_URL,
    notes: (data.body || "").trim().slice(0, 400),
    assets,
  };
}

function saveJson(key: string, value: string | number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

async function downloadText(url: string): Promise<string> {
  const resp = await requestUrl({ url, method: "GET" });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.text;
}

/** Find plugin folder inside .obsidian/plugins (folder name may differ from id). */
export async function findPluginDirByApp(app: CalendarPlugin["app"], manifestId: string): Promise<string | null> {
  const configDir = app.vault.configDir;
  const pluginsDir = `${configDir}/plugins`;
  try {
    const entries = await app.vault.adapter.list(pluginsDir);
    for (const dir of entries.folders) {
      try {
        const manifestPath = `${dir}/manifest.json`;
        if (await app.vault.adapter.exists(manifestPath)) {
          const raw: string = await app.vault.adapter.read(manifestPath);
          const manifest: { id?: string } = JSON.parse(raw) as { id?: string };
          if (manifest.id === manifestId) return dir;
        }
      } catch {
        /* skip broken manifest */
      }
    }
  } catch {
    /* list failed */
  }
  return null;
}

/**
 * Download release files into the plugin folder and reload the plugin.
 * Writes main.js, styles.css (if present), manifest.json.
 */
export async function updatePluginNow(
  plugin: CalendarPlugin,
  release: LatestRelease
): Promise<{ ok: boolean; error?: string }> {
  try {
    const pluginDir = await plugin.findPluginDir();
    if (!pluginDir) return { ok: false, error: "plugin folder not found" };

    const adapter = plugin.app.vault.adapter;

    // Always refresh main.js + manifest; styles only if shipped
    if (!release.assets.mainJs) return { ok: false, error: "main.js missing in release" };

    const mainJs = await downloadText(release.assets.mainJs);
    if (!mainJs || !mainJs.includes("obsidian")) {
      return { ok: false, error: "downloaded main.js looks invalid" };
    }

    await adapter.write(`${pluginDir}/main.js`, mainJs);

    if (release.assets.manifestJson) {
      const manifestText = await downloadText(release.assets.manifestJson);
      await adapter.write(`${pluginDir}/manifest.json`, manifestText);
    }

    if (release.assets.stylesCss) {
      const styles = await downloadText(release.assets.stylesCss);
      await adapter.write(`${pluginDir}/styles.css`, styles);
    }

    saveJson(LAST_NOTIFIED_KEY, release.version);
    pluginUpdateInfo.set({ version: null });

    // Hot-reload plugin if the API is available
    const plugins = (plugin.app as unknown as {
      plugins?: {
        disablePlugin?: (id: string) => Promise<void>;
        enablePlugin?: (id: string) => Promise<void>;
      };
    }).plugins;
    if (plugins?.disablePlugin && plugins?.enablePlugin) {
      await plugins.disablePlugin(plugin.manifest.id);
      await plugins.enablePlugin(plugin.manifest.id);
      return { ok: true };
    }

    return { ok: true, error: "reload-required" };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "update failed" };
  }
}

function showUpdateNotice(
  latest: LatestRelease,
  current: string,
  plugin: CalendarPlugin
): void {
  const notice = new Notice("", 0);
  const root = notice.messageEl;

  root.createDiv({
    text: tRaw("settings.update.availableTitle", { version: latest.version, current }),
    cls: "worklife-update-title",
  });

  if (latest.notes) {
    root.createDiv({ text: latest.notes, cls: "worklife-update-notes" });
  }

  const actions = root.createDiv({ cls: "worklife-update-actions" });

  const updateBtn = actions.createEl("button", {
    text: tRaw("settings.update.updateNow"),
    cls: "mod-cta",
  });
  updateBtn.addEventListener("click", () => {
    void (async () => {
      updateBtn.disabled = true;
      updateBtn.textContent = tRaw("settings.update.updating");
      const result = await updatePluginNow(plugin, latest);
      updateBtn.disabled = false;
      if (result.ok && result.error === "reload-required") {
        updateBtn.textContent = tRaw("settings.update.updateSuccess", { version: latest.version });
        new Notice(tRaw("settings.update.reloadRequired"));
        notice.hide();
        return;
      }
      if (result.ok) {
        updateBtn.textContent = tRaw("settings.update.updateSuccess", { version: latest.version });
        new Notice(tRaw("settings.update.updateSuccess", { version: latest.version }));
        notice.hide();
        return;
      }
      updateBtn.textContent = tRaw("settings.update.updateFailed");
      new Notice(`${tRaw("settings.update.updateFailed")}: ${result.error || ""}`);
    })();
  });

  actions.createEl("button", {
    text: tRaw("settings.update.dismiss"),
  }).addEventListener("click", () => notice.hide());
}

/**
 * Check GitHub releases for a newer plugin version.
 * Runs on every Obsidian open — always fetches; notice once per version.
 * `force` re-shows the notice even for the same version.
 */
export async function checkForPluginUpdate(
  plugin: CalendarPlugin,
  opts: { force?: boolean } = {}
): Promise<LatestRelease | null> {
  const current = plugin.manifest.version;

  let latest: LatestRelease | null = null;
  try {
    latest = await fetchLatestRelease();
  } catch (e: unknown) {
    console.warn("[update-check] failed:", e);
    return null;
  }
  if (!latest) return null;

  if (compareVersions(latest.version, current) <= 0) {
    pluginUpdateInfo.set({ version: null });
    try {
      window.localStorage.removeItem(LAST_NOTIFIED_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }

  pluginUpdateInfo.set({ version: latest.version });

  const notified = window.localStorage.getItem(LAST_NOTIFIED_KEY);
  if (!opts.force && notified === latest.version) return latest;

  saveJson(LAST_NOTIFIED_KEY, latest.version);
  saveJson(LAST_CHECK_KEY, Date.now());
  showUpdateNotice(latest, current, plugin);

  const optsSettings = plugin.options;
  if (optsSettings.ntfyEnabled && optsSettings.ntfyTopic && !plugin.notificationService?.isNtfyScheduledDisabledOnThisDevice()) {
    const bodyLines = [
      tRaw("settings.update.availableTitle", { version: latest.version, current }),
      latest.notes || "",
      tRaw("settings.update.openRelease") + ": " + latest.url,
    ].filter(Boolean);

    void requestUrl({
      url: `https://ntfy.sh/${encodeURIComponent(optsSettings.ntfyTopic)}`,
      method: "POST",
      headers: {
        "X-Title": tRaw("settings.update.availableTitle", { version: latest.version, current }),
        "X-Tags": "worklife,rocket",
        "X-Click": latest.url,
        "X-Sequence-ID": `plugin-update-${latest.version}`,
      },
      body: bodyLines.join("\n\n"),
    }).catch(() => {
      /* ntfy push is best-effort */
    });
  }

  return latest;
}
