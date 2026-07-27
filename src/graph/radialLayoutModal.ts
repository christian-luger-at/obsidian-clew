import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { NoteSuggest } from './noteSuggest';

/**
 * Picks the one note the radial layout (radialLayout.ts) rings out from.
 * Note selection is restricted to `candidates` (the notes currently in the
 * graph) - same reasoning as PathfindingModal's source/target pickers:
 * picking a note outside the graph would just silently be a no-op.
 */
export class RadialLayoutModal extends Modal {
	private focusFile: TFile | null = null;

	constructor(
		app: App,
		private readonly candidates: TFile[],
		private readonly onSubmit: (focusFile: TFile) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Radial layout' });

		new Setting(contentEl).setName('Center on').addText((text) => {
			text.setPlaceholder('Note…');
			const suggest = new NoteSuggest(this.app, text.inputEl, this.candidates);
			suggest.onSelect((file) => {
				this.focusFile = file;
				suggest.setValue(file.basename);
				suggest.close();
			});
		});

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Apply')
				.setCta()
				.onClick(() => {
					if (!this.focusFile) {
						new Notice('Pick a note to center the layout on.');
						return;
					}
					const focusFile = this.focusFile;
					this.close();
					this.onSubmit(focusFile);
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
