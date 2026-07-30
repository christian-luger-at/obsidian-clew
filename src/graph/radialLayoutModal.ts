import { App, Modal, Setting, TFile } from 'obsidian';
import { NoteSuggest } from './noteSuggest';

/**
 * Picks the one note the radial layout (radialLayout.ts) rings out from.
 * Note selection is restricted to `candidates` (the notes currently in the
 * graph) - same reasoning as PathfindingModal's source/target pickers:
 * picking a note outside the graph would just silently be a no-op.
 */
export class RadialLayoutModal extends Modal {
	private focusFile: TFile | null = null;
	private errorEl!: HTMLElement;

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
		contentEl.createEl('p', {
			text: 'Rings the graph out from the note you pick below, by link distance: its direct links land on the first ring, their links on the next ring out, and so on. Notes not reachable from it at all land on one further ring, past the rest.',
			cls: 'clew-modal-description',
		});

		new Setting(contentEl).setName('Center on').addText((text) => {
			text.setPlaceholder('Note…');
			text.inputEl.addClass('clew-note-picker-input');
			const suggest = new NoteSuggest(this.app, text.inputEl, this.candidates);
			suggest.onSelect((file) => {
				this.focusFile = file;
				suggest.setValue(file.basename);
				suggest.close();
				this.errorEl.setText('');
			});
		});

		// In-dialog, not a Notice (top-right toast) - the modal is still
		// open right in front of the user, so the error belongs right next
		// to the field it's about, not somewhere else on screen.
		this.errorEl = contentEl.createEl('p', { cls: 'clew-modal-error' });

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Apply')
				.setCta()
				.onClick(() => {
					if (!this.focusFile) {
						this.errorEl.setText('Pick a note to center the layout on.');
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
