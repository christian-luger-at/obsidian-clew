import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, ClewSettings, ClewSettingTab } from './settings';
import { CLEW_SPIKE_GRAPH_VIEW, SpikeGraphView } from './graph/basesSpikeView';
import { CLEW_GRAPH_VIEW, GraphView } from './graph/graphView';
import { CLEW_STANDALONE_GRAPH_VIEW, StandaloneGraphView } from './graph/standaloneGraphView';
import { GraphPane } from './graph/graphPane';

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
			console.warn('[Clew] Bases is not enabled in this vault; the Bases-integrated graph views are unavailable.');
		}

		this.registerView(CLEW_STANDALONE_GRAPH_VIEW, (leaf) => new StandaloneGraphView(leaf));

		this.addRibbonIcon('lucide-share-2', 'Open graph', () => {
			void this.activateStandaloneGraphView();
		});
		this.addCommand({
			id: 'open-graph',
			name: 'Open graph',
			callback: () => void this.activateStandaloneGraphView(),
		});

		this.addCommand({
			id: 'find-path',
			name: 'Find path between two notes',
			checkCallback: (checking) => {
				const pane = GraphPane.getActive();
				if (!pane) return false;
				if (!checking) pane.openPathfindingModal();
				return true;
			},
		});
	}

	onunload() {}

	private async activateStandaloneGraphView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(CLEW_STANDALONE_GRAPH_VIEW);
		let leaf: WorkspaceLeaf;
		if (existing.length > 0) {
			leaf = existing[0]!;
		} else {
			leaf = this.app.workspace.getLeaf(true);
			await leaf.setViewState({ type: CLEW_STANDALONE_GRAPH_VIEW, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

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
