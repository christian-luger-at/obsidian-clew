import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_APPEARANCE_SETTINGS, DEFAULT_DIAGNOSTICS_SETTINGS, DEFAULT_TIMELINE_SETTINGS, ClewSettings } from './settings';
import { CLEW_STANDALONE_GRAPH_VIEW, StandaloneGraphView } from './graph/standaloneGraphView';
import { FIND_PATH_ENABLED, GraphPane } from './graph/graphPane';
import { registerGraphEmbed } from './graph/graphEmbed';
import { ClewSettingTab } from './settingsTab';
import { reportError } from './errorReporting';
import { terminateEmbeddingWorker } from './graph/embeddingModel';

export default class ClewPlugin extends Plugin {
	settings!: ClewSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new ClewSettingTab(this.app, this));

		this.registerView(CLEW_STANDALONE_GRAPH_VIEW, (leaf) => new StandaloneGraphView(leaf, this));

		// GitHub issue #4, "Code-Fence Embed": ```clew-graph renders an
		// inline ego-graph inside a note.
		registerGraphEmbed(this);

		this.addRibbonIcon('lucide-share-2', 'Open graph', () => {
			void this.activateStandaloneGraphView();
		});
		this.addCommand({
			id: 'open-graph',
			name: 'Open graph view',
			callback: () => void this.activateStandaloneGraphView(),
		});

		// See FIND_PATH_ENABLED's own docstring for the gate this command
		// (and the toolbar icon) shares.
		if (FIND_PATH_ENABLED) {
			this.addCommand({
				id: 'find-path',
				name: 'Find path between two notes',
				checkCallback: (checking) => {
					const pane = GraphPane.getActive();
					if (!pane) return false;
					if (!checking) pane.togglePathfindingPanel();
					return true;
				},
			});
		}

		this.registerGlobalErrorReporting();
	}

	/**
	 * Backlog "Rang 7", "Fehlerhandling" - catches uncaught errors/rejected
	 * promises that originate from Clew's own bundled code specifically,
	 * not Obsidian core or another plugin, and routes them through
	 * errorReporting.ts's `reportError()` (console always, a copyable
	 * Notice too when `settings.debugMode` is on).
	 *
	 * Filtered by `plugin:${this.manifest.id}` - confirmed directly, not
	 * assumed, by throwing a real error from inside a bundled command
	 * callback and inspecting the resulting `ErrorEvent`/
	 * `PromiseRejectionEvent`: Obsidian's plugin loader names each plugin's
	 * evaluated source `plugin:<id>` (no path/extension), which is exactly
	 * what `ErrorEvent.filename` reports for a synchronous throw, and what
	 * `Error.stack`'s own first frame names for an async one - a bug inside
	 * Obsidian core or a different plugin reports its *own* different
	 * source name instead, so this cleanly excludes them rather than
	 * showing a notice for something Clew had nothing to do with.
	 * `registerDomEvent` (not a bare `window.addEventListener`) so both
	 * listeners are automatically removed on unload, same as every other
	 * event this plugin registers.
	 */
	private registerGlobalErrorReporting(): void {
		const ownSource = `plugin:${this.manifest.id}`;
		this.registerDomEvent(window, 'error', (event) => {
			if (event.filename !== ownSource) return;
			reportError('Uncaught error', event.error ?? event.message, this.settings.debugMode);
		});
		this.registerDomEvent(window, 'unhandledrejection', (event) => {
			const stack = event.reason instanceof Error ? event.reason.stack : undefined;
			if (!stack?.includes(`${ownSource}:`)) return;
			reportError('Unhandled promise rejection', event.reason, this.settings.debugMode);
		});
	}

	onunload() {
		// A running embedding worker (and the model it's holding in memory)
		// is background state this plugin owns, not something Obsidian
		// itself would ever clean up on a disable/reload - see
		// embeddingModel.ts's own docstring on terminateEmbeddingWorker().
		terminateEmbeddingWorker();
	}

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
		const loaded = (await this.loadData()) as Partial<ClewSettings> | null;
		this.settings = {
			// Merged field-by-field (not a single top-level spread over a
			// DEFAULT_SETTINGS constant) so every load gets its own fresh
			// objects - GraphPane's Appearance panel sliders mutate
			// settings.appearance in place, which would otherwise alias and
			// corrupt a shared module-level default across plugin reloads.
			// Field-by-field also means a saved file predating a newly-added
			// appearance setting still gets that setting's default, rather
			// than a blanket object-replace silently dropping it.
			appearance: { ...DEFAULT_APPEARANCE_SETTINGS, ...loaded?.appearance },
			pinnedPositions: { ...loaded?.pinnedPositions },
			filterPresets: [...(loaded?.filterPresets ?? [])],
			filterCombineMode: loaded?.filterCombineMode ?? 'or',
			nodeGroups: [...(loaded?.nodeGroups ?? [])],
			timeline: { ...DEFAULT_TIMELINE_SETTINGS, ...loaded?.timeline },
			diagnostics: { ...DEFAULT_DIAGNOSTICS_SETTINGS, ...loaded?.diagnostics },
			pathfindingExcludedNotes: [...(loaded?.pathfindingExcludedNotes ?? [])],
			pathfindingExcludedFolders: [...(loaded?.pathfindingExcludedFolders ?? [])],
			savedViews: [...(loaded?.savedViews ?? [])],
			debugMode: loaded?.debugMode ?? false,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
