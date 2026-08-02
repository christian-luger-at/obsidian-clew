import { App, Modal, Setting } from 'obsidian';

/**
 * A generic Yes/No confirmation - Obsidian's own API has no built-in
 * confirm() dialog, and a native browser confirm() would look out of place
 * next to every other Clew dialog (RadialLayoutModal, PathfindingModal,
 * ...). Currently only used for deleting a node group (a real "you'll lose
 * this" action - see graphPane.ts's deleteGroup()), but kept generic
 * (title/message/confirm text are all parameters) rather than group-
 * specific, since any future destructive action can reuse it as-is.
 */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly message: string,
		private readonly confirmText: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.title });
		contentEl.createEl('p', { text: this.message, cls: 'clew-modal-description' });

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(this.confirmText)
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
