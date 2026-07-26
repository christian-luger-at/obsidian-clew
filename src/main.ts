import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, ClewSettings, ClewSettingTab } from './settings';
import { CLEW_STANDALONE_GRAPH_VIEW, StandaloneGraphView } from './graph/standaloneGraphView';
import { GraphPane } from './graph/graphPane';

export default class ClewPlugin extends Plugin {
	settings!: ClewSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ClewSettingTab(this.app, this));

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
