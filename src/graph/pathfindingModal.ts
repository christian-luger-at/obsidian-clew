import { AbstractInputSuggest, App, Modal, Notice, Setting, TFile } from 'obsidian';

class NoteSuggest extends AbstractInputSuggest<TFile> {
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

export interface PathfindingRequest {
	source: TFile;
	target: TFile;
	directed: boolean;
}

/**
 * Note selection is restricted to `candidates` - the notes currently in the
 * Bases-filtered graph, not the whole vault. Picking a note outside that set
 * would just fail to find a path for a confusing reason (it isn't part of
 * the graph being searched at all).
 */
export class PathfindingModal extends Modal {
	private sourceFile: TFile | null = null;
	private targetFile: TFile | null = null;
	private directed = false;

	constructor(
		app: App,
		private readonly candidates: TFile[],
		private readonly onSubmit: (request: PathfindingRequest) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Find path between two notes' });

		new Setting(contentEl).setName('From').addText((text) => {
			text.setPlaceholder('Start note…');
			const suggest = new NoteSuggest(this.app, text.inputEl, this.candidates);
			suggest.onSelect((file) => {
				this.sourceFile = file;
				suggest.setValue(file.basename);
				suggest.close();
			});
		});

		new Setting(contentEl).setName('To').addText((text) => {
			text.setPlaceholder('End note…');
			const suggest = new NoteSuggest(this.app, text.inputEl, this.candidates);
			suggest.onSelect((file) => {
				this.targetFile = file;
				suggest.setValue(file.basename);
				suggest.close();
			});
		});

		new Setting(contentEl)
			.setName('Directed')
			.setDesc('Follow links in one direction only, instead of treating them as undirected connections.')
			.addToggle((toggle) => toggle.setValue(this.directed).onChange((value) => (this.directed = value)));

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Find path')
				.setCta()
				.onClick(() => {
					if (!this.sourceFile || !this.targetFile) {
						new Notice('Pick both a start and an end note.');
						return;
					}
					const request: PathfindingRequest = {
						source: this.sourceFile,
						target: this.targetFile,
						directed: this.directed,
					};
					this.close();
					this.onSubmit(request);
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
