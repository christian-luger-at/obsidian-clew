import { AbstractInputSuggest, App, TFolder } from 'obsidian';

/** Same "pick one of the vault's own X via Obsidian's fuzzy-suggest input pattern" as noteSuggest.ts's NoteSuggest, for folders instead of notes - backs the Settings tab's excluded-folders picker (GitHub backlog item 6 follow-up: "In Settings sollen ganze Ordner ausgeschlossen werden."). */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly candidates: TFolder[],
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFolder[] {
		// Same "nothing until you've typed something" reasoning as
		// NoteSuggest - see its own docstring.
		if (!query.trim()) return [];
		const q = query.toLowerCase();
		return this.candidates.filter((folder) => folder.path.toLowerCase().includes(q)).slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}
}
