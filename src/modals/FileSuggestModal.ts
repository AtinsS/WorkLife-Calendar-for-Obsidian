import { App, SuggestModal, TFile } from "obsidian";

export interface FileSuggestion {
  file: TFile;
  path: string;
}

export class FileSuggestModal extends SuggestModal<FileSuggestion> {
  private files: TFile[];
  private onSelect: (filePath: string) => void;

  constructor(app: App, onSelect: (filePath: string) => void) {
    super(app);
    this.files = this.getVaultFiles();
    this.onSelect = onSelect;
    this.setPlaceholder("Поиск заметки...");
  }

  getSuggestions(query: string): FileSuggestion[] {
    const lowerQuery = query.toLowerCase();
    return this.files
      .filter(
        (file) =>
          file.path.toLowerCase().includes(lowerQuery) ||
          file.basename.toLowerCase().includes(lowerQuery)
      )
      .map((file) => ({ file, path: file.path }));
  }

  renderSuggestion(suggestion: FileSuggestion, el: HTMLElement): void {
    const div = el.createDiv({ cls: "file-suggest-item" });
    div.createSpan({
      text: suggestion.file.basename,
      cls: "file-suggest-name",
    });
    div.createSpan({
      text: suggestion.path,
      cls: "file-suggest-path",
    });
  }

  onChooseSuggestion(suggestion: FileSuggestion): void {
    this.onSelect(suggestion.path);
  }

  private getVaultFiles(): TFile[] {
    return this.app.vault.getFiles().sort((a, b) => a.path.localeCompare(b.path));
  }
}
