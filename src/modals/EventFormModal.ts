import type { App } from "obsidian";
import { CustomModal } from "../ui/CustomModal";
import { tRaw } from "../i18n";
import { newCustomEventId, CUSTOM_EVENTS_COLOR, type ICustomEvent } from "../services/customEvents";
import { renderColorPicker } from "../task-tracker/ProjectModal";

/** Create (`event === null`) or edit a user event («Мои события»). */
export class EventFormModal extends CustomModal {
  private event: ICustomEvent | null;
  private defaultDate: string;
  private onSave: (event: ICustomEvent) => void;

  constructor(
    app: App,
    event: ICustomEvent | null,
    onSave: (event: ICustomEvent) => void,
    defaultDate?: string,
  ) {
    super(app);
    this.event = event;
    this.onSave = onSave;
    this.defaultDate = defaultDate || todayKey();
  }

  onOpen(): void {
    const isEdit = this.event !== null;
    this.containerEl.addClass("wl-event-modal");
    this.contentEl.createEl("h2", {
      text: isEdit ? tRaw("customEvents.editTitle") : tRaw("customEvents.newTitle"),
    });

    let title = this.event?.title ?? "";
    let allDay = this.event?.allDay ?? true;
    let startDate = this.event?.startDate ?? this.defaultDate;
    let endDate = this.event?.endDate ?? "";
    let startTime = this.event?.startTime ?? "";
    let endTime = this.event?.endTime ?? "";
    let description = this.event?.description ?? "";
    let location = this.event?.location ?? "";
    let color = this.event?.color ?? CUSTOM_EVENTS_COLOR;

    // Title
    const titleField = this.contentEl.createDiv("pm-field");
    titleField.createEl("label", { text: tRaw("customEvents.title"), cls: "pm-label" });
    const titleInput = titleField.createEl("input", {
      cls: "pm-input",
      attr: {
        type: "text",
        placeholder: tRaw("customEvents.titlePlaceholder"),
        value: title,
        maxlength: "120",
      },
    });
    titleInput.addEventListener("input", () => {
      title = titleInput.value;
    });

    // All-day toggle
    const allDayRow = this.contentEl.createDiv("wl-event-allday");
    const allDayLabel = allDayRow.createEl("label", { cls: "wl-event-allday-label" });
    const allDayInput = allDayLabel.createEl("input", {
      attr: { type: "checkbox", ...(allDay ? { checked: "true" } : {}) },
    });
    allDayLabel.createSpan({ text: tRaw("customEvents.allDay") });

    // Color
    const colorSection = this.contentEl.createDiv("pm-field");
    colorSection.createEl("label", { text: tRaw("customEvents.color"), cls: "pm-label" });
    renderColorPicker(colorSection, color, (hex) => {
      color = hex;
    });

    // Date / time row
    const row = this.contentEl.createDiv("wl-event-row");
    const dateField = row.createDiv("pm-field wl-event-cell");
    dateField.createEl("label", { text: tRaw("customEvents.date"), cls: "pm-label" });
    const dateInput = dateField.createEl("input", {
      cls: "pm-input",
      attr: { type: "date", value: startDate },
    });
    dateInput.addEventListener("input", () => {
      startDate = dateInput.value;
    });

    const endField = row.createDiv("pm-field wl-event-cell");
    endField.createEl("label", { text: tRaw("customEvents.endDate"), cls: "pm-label" });
    const endInput = endField.createEl("input", {
      cls: "pm-input",
      attr: { type: "date", value: endDate },
    });
    endInput.addEventListener("input", () => {
      endDate = endInput.value;
    });

    const startField = row.createDiv("pm-field wl-event-cell");
    startField.createEl("label", { text: tRaw("customEvents.startTime"), cls: "pm-label" });
    const startInput = startField.createEl("input", {
      cls: "pm-input",
      attr: { type: "time", value: startTime },
    });
    startInput.addEventListener("input", () => {
      startTime = startInput.value;
    });

    const endTField = row.createDiv("pm-field wl-event-cell");
    endTField.createEl("label", { text: tRaw("customEvents.endTime"), cls: "pm-label" });
    const endTInput = endTField.createEl("input", {
      cls: "pm-input",
      attr: { type: "time", value: endTime },
    });
    endTInput.addEventListener("input", () => {
      endTime = endTInput.value;
    });

    const syncTimeVisibility = () => {
      endField.style.display = allDay ? "" : "none";
      startField.style.display = allDay ? "none" : "";
      endTField.style.display = allDay ? "none" : "";
    };
    allDayInput.addEventListener("change", () => {
      allDay = allDayInput.checked;
      syncTimeVisibility();
    });
    syncTimeVisibility();

    // Description
    const descField = this.contentEl.createDiv("pm-field");
    descField.createEl("label", { text: tRaw("customEvents.description"), cls: "pm-label" });
    const descInput = descField.createEl("textarea", {
      cls: "pm-input wl-event-textarea",
      attr: { placeholder: tRaw("customEvents.descriptionPlaceholder"), rows: "3" },
    });
    descInput.value = description;
    descInput.addEventListener("input", () => {
      description = descInput.value;
    });

    // Location
    const locField = this.contentEl.createDiv("pm-field");
    locField.createEl("label", { text: tRaw("customEvents.location"), cls: "pm-label" });
    const locInput = locField.createEl("input", {
      cls: "pm-input",
      attr: { type: "text", placeholder: tRaw("customEvents.locationPlaceholder"), value: location, maxlength: "120" },
    });
    locInput.addEventListener("input", () => {
      location = locInput.value;
    });

    // Buttons
    const buttonsEl = this.contentEl.createDiv("pm-modal-buttons");
    const cancelBtn = buttonsEl.createEl("button", {
      text: tRaw("common.cancel"),
      cls: "pm-cancel-btn",
    });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = buttonsEl.createEl("button", {
      text: isEdit ? tRaw("common.save") : tRaw("customEvents.create"),
      cls: "pm-save-btn",
    });
    saveBtn.addEventListener("click", () => {
      const flash = (input: HTMLInputElement | HTMLTextAreaElement) => {
        input.classList.add("pm-input-error");
        window.setTimeout(() => input.classList.remove("pm-input-error"), 1500);
        input.focus();
      };
      if (!title.trim()) {
        flash(titleInput);
        return;
      }
      if (!startDate) {
        flash(dateInput);
        return;
      }
      if (!allDay && startTime && endTime && endTime <= startTime) {
        flash(endTInput);
        return;
      }

      const saved: ICustomEvent = {
        id: this.event?.id ?? newCustomEventId(),
        title: title.trim(),
        startDate,
        allDay,
        color,
        description: description.trim() || undefined,
        location: location.trim() || undefined,
      };
      if (allDay) {
        if (endDate && endDate > startDate) saved.endDate = endDate;
      } else {
        if (startTime) saved.startTime = startTime;
        if (endTime) saved.endTime = endTime;
      }
      this.onSave(saved);
      this.close();
    });

    window.setTimeout(() => titleInput.focus(), 50);
  }

  onClose(): void {
    // no-op lifecycle hook
  }
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
