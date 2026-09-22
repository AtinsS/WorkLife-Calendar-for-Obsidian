/**
 * Root Jest mock for the `obsidian` package (types-only in node_modules).
 * Required so unit tests can import runtime values from "obsidian".
 */
/* eslint-disable @typescript-eslint/no-empty-function */
import momentLib from "moment";

// Obsidian's `moment` export is the callable moment function.
export const moment = momentLib as unknown as typeof momentLib;

export class TFile {
  path = "";
  basename = "";
  extension = "md";
  name = "";
  parent: unknown = null;
}

export class TFolder {
  path = "";
  name = "";
  children: Array<TFolder | TFile> = [];
  constructor(path?: string) {
    if (path) this.path = path;
  }
}

export class TAbstractFile {
  path = "";
  name = "";
}

export class PluginSettingTab {
  app: unknown;
  containerEl: HTMLElement | null = null;
  constructor(app?: unknown) {
    this.app = app;
  }
  display(): void {}
  hide(): void {}
}

export class Modal {
  app: unknown;
  contentEl: HTMLElement | null = null;
  constructor(app?: unknown) {
    this.app = app;
  }
  open(): void {}
  close(): void {}
}

export class SuggestModal<T> {
  app: unknown;
  constructor(app?: unknown) {
    this.app = app;
  }
  setPlaceholder(_: string): void {}
  open(): void {}
  close(): void {}
  getSuggestions(_query: string): T[] {
    return [];
  }
  renderSuggestion(_suggestion: T, _el: HTMLElement): void {}
  onChooseSuggestion(_suggestion: T): void {}
}

export class Notice {
  constructor(_message?: string, _timeout?: number) {}
}

export class Plugin {
  app: unknown;
  constructor(app?: unknown) {
    this.app = app;
  }
  loadData(): Promise<unknown> {
    return Promise.resolve({});
  }
  saveData(_data: unknown): Promise<void> {
    return Promise.resolve();
  }
  addCommand(_cmd: unknown): void {}
  addRibbonIcon(_icon: string, _title: string, _cb: unknown): HTMLElement | null {
    return null;
  }
  addSettingTab(_tab: unknown): void {}
  registerView(_type: string, _view: unknown): void {}
}

export class ItemView {
  app: unknown;
  containerEl: HTMLElement | null = null;
  constructor(_leaf?: unknown) {}
  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  getIcon(): string {
    return "";
  }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

export class WorkspaceLeaf {
  app: unknown;
  view: unknown = null;
}

export class MarkdownView {}
export class FileView {}
export class Menu {}
export class Setting {
  constructor(_container?: unknown) {}
  setName(_name: string): Setting {
    return this;
  }
  setDesc(_desc: string): Setting {
    return this;
  }
  addText(_cb: unknown): Setting {
    return this;
  }
  addToggle(_cb: unknown): Setting {
    return this;
  }
  addButton(_cb: unknown): Setting {
    return this;
  }
  addDropdown(_cb: unknown): Setting {
    return this;
  }
  addTextArea(_cb: unknown): Setting {
    return this;
  }
}
export class TextComponent {}
export class Point {}

export function normalizePath(path: string): string {
  return path;
}

export function parseFrontMatterTags(_fm: unknown): string[] | null {
  return null;
}

export function isTFile(file: unknown): boolean {
  return file instanceof TFile;
}

export function isTFolder(file: unknown): boolean {
  return file instanceof TFolder;
}

// Mock requestUrl for API client tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const requestUrl = jest.fn().mockResolvedValue({ status: 200, text: "{}", json: {} } as any);

export class App {
  vault: unknown;
  workspace: unknown;
  constructor() {
    this.vault = {
      getRoot: () => new TFolder(""),
      getAbstractFileByPath: () => null,
      read: () => Promise.resolve(""),
      modify: () => Promise.resolve(),
      create: () => Promise.resolve(new TFile()),
      createDir: () => Promise.resolve(),
    };
  }
}
