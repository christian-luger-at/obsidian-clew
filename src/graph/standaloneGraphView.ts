import { ItemView, WorkspaceLeaf } from 'obsidian';
import { GraphPane } from './graphPane';

/**
 * The graph view: opened directly via ribbon icon or command, showing the
 * whole vault's markdown notes.
 */

export const CLEW_STANDALONE_GRAPH_VIEW = 'clew-standalone-graph';

const REFRESH_DEBOUNCE_MS = 800;

export class StandaloneGraphView extends ItemView {
	private pane: GraphPane | null = null;
	private refreshTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return CLEW_STANDALONE_GRAPH_VIEW;
	}

	getDisplayText(): string {
		return 'Graph';
	}

	getIcon(): string {
		return 'lucide-share-2';
	}

	async onOpen(): Promise<void> {
		this.pane = new GraphPane(this.app, this.contentEl);
		this.refresh();

		// Vault-wide, so react to it changing - debounced, since a sync or a
		// bulk operation can fire many of these in a burst and each refresh
		// resets the layout and re-settles it (see GraphPane.setFiles).
		this.registerEvent(this.app.vault.on('create', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRefresh()));
	}

	onClose(): Promise<void> {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.pane?.destroy();
		return Promise.resolve();
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
	}

	private refresh(): void {
		this.pane?.setFiles(this.app.vault.getMarkdownFiles());
	}
}
