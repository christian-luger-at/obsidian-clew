import { App, PluginSettingTab, Setting } from 'obsidian';
import ClewPlugin from './main';

export interface ClewSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: ClewSettings = {
	mySetting: 'default',
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

		new Setting(containerEl)
			.setName('Settings #1')
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder('Enter your secret')
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
