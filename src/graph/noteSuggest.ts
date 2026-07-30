import { AbstractInputSuggest, App, TFile } from 'obsidian';

/** Shared by PathfindingModal (source/target) and RadialLayoutModal (focus note) - both need "pick one of the notes currently in the graph" via Obsidian's own fuzzy-suggest input pattern. */
export class NoteSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly candidates: TFile[],
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFile[] {
		// An empty query matches every candidate's path (`"".includes()` is
		// always true), which without this would show the full note list
		// the moment the input gains focus - before the user has typed
		// anything. No suggestions at all until there's something to
		// actually filter by.
		if (!query.trim()) return [];
		const q = query.toLowerCase();
		return this.candidates.filter((file) => file.path.toLowerCase().includes(q)).slice(0, 50);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}
}
