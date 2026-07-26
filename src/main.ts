import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, ClewSettings, ClewSettingTab } from './settings';
import { CLEW_SPIKE_GRAPH_VIEW, SpikeGraphView } from './graph/basesSpikeView';

export default class ClewPlugin extends Plugin {
	settings!: ClewSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ClewSettingTab(this.app, this));

		const registered = this.registerBasesView(CLEW_SPIKE_GRAPH_VIEW, {
			name: 'Graph (spike)',
			icon: 'lucide-share-2',
			factory: (controller, containerEl) => new SpikeGraphView(controller, containerEl),
		});
		if (!registered) {
			console.warn('[Clew] Bases is not enabled in this vault; the spike graph view is unavailable.');
		}
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ClewSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
