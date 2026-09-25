<script lang="ts">
  import { t } from "../i18n";
  import { weightData, setWeightEntry } from "./stores";
  import { latestWeight } from "./stats";
  import { toDateKey } from "./types";

  let weightInput: string | number = "";
  let flash: "ok" | "err" | "" = "";

  $: entries = $weightData.entries;
  $: latest = latestWeight(entries);
  $: latestLabel = latest
    ? `${latest.weight.toFixed(1).replace(/\.0$/, "")} ${$t("weight.unit")}`
    : "";

  function parseWeight(raw: string | number | null | undefined): number | null {
    if (raw === "" || raw == null) return null;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).trim().replace(",", "."));
    return isFinite(n) && n > 0 ? n : null;
  }

  function onSave(): void {
    const w = parseWeight(weightInput);
    if (w == null) {
      flash = "err";
      window.setTimeout(() => (flash = ""), 2000);
      return;
    }
    setWeightEntry(toDateKey(new Date()), w);
    weightInput = "";
    flash = "ok";
    window.setTimeout(() => (flash = ""), 1500);
  }
</script>

<div class="wqi" class:ok={flash === "ok"} class:err={flash === "err"}>
  <span class="wqi-icon" aria-hidden="true">⚖️</span>
  <input
    class="wqi-input"
    type="number"
    step="0.1"
    min="1"
    placeholder={latestLabel || $t("weight.quickTitle")}
    title={$t("weight.quickTitle")}
    bind:value={weightInput}
    on:keydown={(e) => e.key === "Enter" && onSave()}
  />
  <button class="wqi-btn" on:click={onSave} title={$t("weight.save")}>✓</button>
</div>

<style>
  .wqi {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 2px 2px 2px 10px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
    transition: border-color 0.2s, background 0.2s;
    box-sizing: border-box;
  }

  .wqi:focus-within {
    border-color: rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
  }

  .wqi.ok {
    border-color: var(--mcp-success, rgba(34, 197, 94, 0.5));
  }

  .wqi.err {
    border-color: var(--mcp-danger, rgba(220, 100, 100, 0.6));
  }

  .wqi-icon {
    font-size: 13px;
    line-height: 1;
    opacity: 0.75;
    flex-shrink: 0;
  }

  .wqi-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--text-normal, #e8ecf0);
    font-size: 13px;
    padding: 8px 0;
    outline: none;
    font-family: inherit;
  }

  .wqi-input::placeholder {
    color: var(--text-faint, #4b5563);
    opacity: 0.9;
  }

  /* hide number spinners for cleaner compact look */
  .wqi-input::-webkit-outer-spin-button,
  .wqi-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .wqi-input[type="number"] {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .wqi-btn {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: var(--mcp-accent);
    color: var(--text-on-accent, #fff);
    font-size: 14px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    line-height: 1;
  }

  .wqi-btn:hover {
    filter: brightness(1.08);
  }
</style>
