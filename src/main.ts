import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, ClewSettings, ClewSettingTab } from './settings';
import { CLEW_SPIKE_GRAPH_VIEW, SpikeGraphView } from './graph/basesSpikeView';
import { CLEW_GRAPH_VIEW, GraphView } from './graph/graphView';

export default class ClewPlugin extends Plugin {
	settings!: ClewSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ClewSettingTab(this.app, this));

		const graphRegistered = this.registerBasesView(CLEW_GRAPH_VIEW, {
			name: 'Graph',
			icon: 'lucide-share-2',
			factory: (controller, containerEl) => new GraphView(controller, containerEl),
		});
		// Dev-only perf/reference check, see DEVELOPMENT.md - not the view real usage goes through.
		const spikeRegistered = this.registerBasesView(CLEW_SPIKE_GRAPH_VIEW, {
			name: 'Graph (spike)',
			icon: 'lucide-share-2',
			factory: (controller, containerEl) => new SpikeGraphView(controller, containerEl),
		});
		if (!graphRegistered || !spikeRegistered) {
			console.warn('[Clew] Bases is not enabled in this vault; the graph views are unavailable.');
		}

		this.addCommand({
			id: 'find-path',
			name: 'Find path between two notes',
			checkCallback: (checking) => {
				const view = GraphView.getActive();
				if (!view) return false;
				if (!checking) view.openPathfindingModal();
				return true;
			},
		});
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
