import { App, SuggestModal, TFolder } from "obsidian";

export interface FolderSuggestion {
  folder: string;
}

export class FolderSuggestModal extends SuggestModal<FolderSuggestion> {
  private folders: string[];
  private onSelect: (folder: string) => void;

  constructor(app: App, onSelect: (folder: string) => void) {
    super(app);
    this.folders = this.getVaultFolders();
    this.onSelect = onSelect;
    this.setPlaceholder("Поиск папки...");
  }

  getSuggestions(query: string): FolderSuggestion[] {
    const lowerQuery = query.toLowerCase();
    return this.folders
      .filter((folder) => folder.toLowerCase().includes(lowerQuery))
      .map((folder) => ({ folder }));
  }

  renderSuggestion(suggestion: FolderSuggestion, el: HTMLElement): void {
    el.createDiv({ text: suggestion.folder });
  }

  onChooseSuggestion(suggestion: FolderSuggestion): void {
    this.onSelect(suggestion.folder);
  }

  private getVaultFolders(): string[] {
    const folders: string[] = [];
    const root = this.app.vault.getRoot();
    const walk = (folder: TFolder) => {
      for (const child of folder.children || []) {
        if (child instanceof TFolder) {
          folders.push(child.path);
          walk(child);
        }
      }
    };
    walk(root);
    return folders.sort();
  }
}
