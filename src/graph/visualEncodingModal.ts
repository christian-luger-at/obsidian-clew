import { App, Modal, Setting } from 'obsidian';

const DEFAULT_OPTION = '';

export interface VisualEncodingRequest {
	/** null = default (cover-image vs. plain, see vaultGraph.ts). */
	colorProperty: string | null;
	/** null = default (degree-based, see vaultGraph.ts's sizeNodesByDegree). */
	sizeProperty: string | null;
}

/**
 * Doc section 3.1 / GitHub issue #1: pick a frontmatter property to drive
 * node color and/or size, instead of the fixed cover-image/degree-based
 * defaults. `availableProperties` is discovered by GraphPane from the
 * current file set (see openVisualEncodingModal), not hardcoded - a
 * property doesn't need to exist on every note to be offered, just at
 * least one.
 */
export class VisualEncodingModal extends Modal {
	private colorProperty: string | null;
	private sizeProperty: string | null;

	constructor(
		app: App,
		private readonly availableProperties: string[],
		current: VisualEncodingRequest,
		private readonly onSubmit: (request: VisualEncodingRequest) => void,
	) {
		super(app);
		this.colorProperty = current.colorProperty;
		this.sizeProperty = current.sizeProperty;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Visual encoding' });

		new Setting(contentEl)
			.setName('Color by property')
			.setDesc('Notes sharing a value get the same color. Notes missing the property keep the default color.')
			.addDropdown((dropdown) => {
				dropdown.addOption(DEFAULT_OPTION, 'Default (cover image)');
				for (const property of this.availableProperties) dropdown.addOption(property, property);
				dropdown.setValue(this.colorProperty ?? DEFAULT_OPTION);
				dropdown.onChange((value) => {
					this.colorProperty = value === DEFAULT_OPTION ? null : value;
				});
			});

		new Setting(contentEl)
			.setName('Size by property')
			.setDesc('Only numeric values are used. Notes missing a numeric value keep the default (link-count) size.')
			.addDropdown((dropdown) => {
				dropdown.addOption(DEFAULT_OPTION, 'Default (link count)');
				for (const property of this.availableProperties) dropdown.addOption(property, property);
				dropdown.setValue(this.sizeProperty ?? DEFAULT_OPTION);
				dropdown.onChange((value) => {
					this.sizeProperty = value === DEFAULT_OPTION ? null : value;
				});
			});

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Apply')
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit({ colorProperty: this.colorProperty, sizeProperty: this.sizeProperty });
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
