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
		const q = query.toLowerCase();
		return this.candidates.filter((file) => file.path.toLowerCase().includes(q)).slice(0, 50);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}
}
