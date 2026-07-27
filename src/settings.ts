import { App, PluginSettingTab, Setting } from 'obsidian';
import ClewPlugin from './main';

export interface PinnedPosition {
	x: number;
	y: number;
}

export interface ClewSettings {
	/**
	 * Manually dragged node positions, keyed by note path - GitHub issue
	 * #12. Not stored in the note's frontmatter (that would be file-content
	 * editing, a much bigger/riskier feature category per the product-vision
	 * doc's "Editability" backlog) - a position is presentation state, not
	 * note content, so it lives in the plugin's own data (this file, backed
	 * by Obsidian's loadData()/saveData()) instead.
	 */
	pinnedPositions: Record<string, PinnedPosition>;
}

export const DEFAULT_SETTINGS: ClewSettings = {
	pinnedPositions: {},
};

export class ClewSettingTab extends PluginSettingTab {
	plugin: ClewPlugin;

	constructor(app: App, plugin: ClewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const count = Object.keys(this.plugin.settings.pinnedPositions).length;

		new Setting(containerEl)
			.setName('Pinned node positions')
			.setDesc(
				count === 0
					? 'No notes have a manually pinned position yet - drag a node in the graph view to pin it.'
					: `${count} note${count === 1 ? '' : 's'} currently ${count === 1 ? 'has' : 'have'} a pinned position.`,
			)
			.addButton((button) =>
				button
					.setButtonText('Clear all pinned positions')
					.setDisabled(count === 0)
					.onClick(async () => {
						this.plugin.settings.pinnedPositions = {};
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}
}
