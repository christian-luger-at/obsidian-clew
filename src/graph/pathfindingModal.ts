import { App, Modal, Setting, TFile } from 'obsidian';
import { NoteSuggest } from './noteSuggest';

export interface PathfindingRequest {
	source: TFile;
	target: TFile;
	directed: boolean;
}

/** What to pre-fill the "From"/"To"/"Directed" fields with when the modal opens - GraphPane.openPathfindingModal()'s own docstring for when this is "the last search" vs. empty. */
export interface PathfindingModalInitial {
	source: TFile | null;
	target: TFile | null;
	directed: boolean;
}

/**
 * Note selection is restricted to `candidates` - the notes currently in the
 * graph being searched. Picking a note outside that set would just fail to
 * find a path for a confusing reason (it isn't part of the graph at all).
 */
export class PathfindingModal extends Modal {
	private sourceFile: TFile | null;
	private targetFile: TFile | null;
	private directed: boolean;
	private errorEl!: HTMLElement;

	constructor(
		app: App,
		private readonly candidates: TFile[],
		private readonly onSubmit: (request: PathfindingRequest) => void,
		initial: PathfindingModalInitial = { source: null, target: null, directed: false },
	) {
		super(app);
		this.sourceFile = initial.source;
		this.targetFile = initial.target;
		this.directed = initial.directed;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Find path between two notes' });
		contentEl.createEl('p', {
			text: 'Finds a route through the link graph from one note to the other, favoring notes with fewer links over big hub/index notes even if that route has more hops - and shows a couple of alternative routes alongside the shortest one. "no path found" is a real, useful result: it means the two notes aren\'t connected at all.',
			cls: 'clew-modal-description',
		});

		// "From"/"To" get a shared class fixing their label-column width
		// (clew-note-picker-setting, styles.css) - without it, Obsidian's
		// Setting layout sizes the label column to fit each name's own text,
		// so "From" (longer) left noticeably less room for its input than
		// "To" did, making the two fields different widths.
		const fromSetting = new Setting(contentEl).setName('From');
		fromSetting.settingEl.addClass('clew-note-picker-setting');
		fromSetting.addText((text) => {
			text.setPlaceholder('Start note…');
			if (this.sourceFile) text.setValue(this.sourceFile.basename);
			text.inputEl.addClass('clew-note-picker-input');
			const suggest = new NoteSuggest(this.app, text.inputEl, this.candidates);
			suggest.onSelect((file) => {
				this.sourceFile = file;
				suggest.setValue(file.basename);
				suggest.close();
				this.errorEl.setText('');
			});
		});

		const toSetting = new Setting(contentEl).setName('To');
		toSetting.settingEl.addClass('clew-note-picker-setting');
		toSetting.addText((text) => {
			text.setPlaceholder('End note…');
			if (this.targetFile) text.setValue(this.targetFile.basename);
			text.inputEl.addClass('clew-note-picker-input');
			const suggest = new NoteSuggest(this.app, text.inputEl, this.candidates);
			suggest.onSelect((file) => {
				this.targetFile = file;
				suggest.setValue(file.basename);
				suggest.close();
				this.errorEl.setText('');
			});
		});

		new Setting(contentEl)
			.setName('Directed')
			.setDesc(
				'Off (default): a link between two notes can be followed either way, regardless of which note it was written in. On: links can only be followed in the direction they were written - if only one note links to another, a path can go from the first to the second but not back.',
			)
			.addToggle((toggle) => toggle.setValue(this.directed).onChange((value) => (this.directed = value)));

		// In-dialog, not a Notice (top-right toast) - the modal is still
		// open right in front of the user, so the error belongs right next
		// to the fields it's about, not somewhere else on screen.
		this.errorEl = contentEl.createEl('p', { cls: 'clew-modal-error' });

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Find path')
				.setCta()
				.onClick(() => {
					if (!this.sourceFile || !this.targetFile) {
						this.errorEl.setText('Pick both a start and an end note.');
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
