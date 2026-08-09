import { App, PluginSettingTab, Setting } from 'obsidian';
import type ClewPlugin from './main';

/**
 * Clew's entry in Obsidian's own Settings screen (Settings → Community
 * plugins → Clew) - the plugin's first, so far. Every other tunable so far
 * (Appearance's sliders, Filter/Color & size, Timeline) lives inside the
 * graph view's own panels instead, since those are things you tune while
 * watching the graph react (see settings.ts's ClewAppearanceSettings
 * docstring). The Diagnostics section toggles here are different: a
 * one-time "what do I even want to see" choice, made once and forgotten,
 * which is what Obsidian's own Settings screen is for - not something that
 * needs the graph on screen to make sense of.
 */
export class ClewSettingTab extends PluginSettingTab {
	private readonly plugin: ClewPlugin;

	constructor(app: App, plugin: ClewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Diagnostics panel').setHeading();
		containerEl.createEl('p', {
			text: 'Choose which sections the diagnostics panel (stethoscope icon, in the graph view) shows.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Orphans')
			.setDesc('Notes with no links in or out.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.diagnostics.showOrphans).onChange(async (value) => {
					this.plugin.settings.diagnostics.showOrphans = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Broken links')
			.setDesc(
				'Links that don\'t resolve to a note. Turn this off if you deliberately link to notes that don\'t exist yet ("stub first, write later") and don\'t want them flagged.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.diagnostics.showBrokenLinks).onChange(async (value) => {
					this.plugin.settings.diagnostics.showBrokenLinks = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Isolated clusters')
			.setDesc("Groups of linked notes that aren't connected to the rest of the vault.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.diagnostics.showIsolatedClusters).onChange(async (value) => {
					this.plugin.settings.diagnostics.showIsolatedClusters = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName('Default filters & colors').setHeading();
		containerEl.createEl('p', {
			text: 'Ready-made filters/color groups, built on notes linked but not created yet. Available in the graph view\'s Filter/Color & size panels - each still needs its own checkbox turned on there to actually apply.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Default filters')
			.setDesc('"Show existing notes" / "Show non-existing notes" in the Filter panel.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showDefaultFilters).onChange(async (value) => {
					this.plugin.settings.showDefaultFilters = value;
					this.plugin.syncDefaultPresets();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Default color group')
			.setDesc('"Non-existing notes" (orange) in the Color & size panel.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showDefaultColorGroups).onChange(async (value) => {
					this.plugin.settings.showDefaultColorGroups = value;
					this.plugin.syncDefaultPresets();
					await this.plugin.saveSettings();
				}),
			);
	}
}
