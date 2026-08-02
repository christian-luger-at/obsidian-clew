import { ItemView, WorkspaceLeaf } from 'obsidian';
import { GraphPane } from './graphPane';
import type ClewPlugin from '../main';

/**
 * The graph view: opened directly via ribbon icon or command, showing the
 * whole vault's markdown notes.
 */

export const CLEW_STANDALONE_GRAPH_VIEW = 'clew-standalone-graph';

const REFRESH_DEBOUNCE_MS = 800;

export class StandaloneGraphView extends ItemView {
	private pane: GraphPane | null = null;
	private refreshTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ClewPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return CLEW_STANDALONE_GRAPH_VIEW;
	}

	getDisplayText(): string {
		return 'Clew graph view';
	}

	getIcon(): string {
		return 'lucide-share-2';
	}

	async onOpen(): Promise<void> {
		this.pane = new GraphPane(this.app, this.contentEl, this.plugin);
		this.refresh();

		// Vault-wide, so react to it changing - debounced, since a sync or a
		// bulk operation can fire many of these in a burst and each refresh
		// resets the layout and re-settles it (see GraphPane.setFiles).
		this.registerEvent(this.app.vault.on('create', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRefresh()));
		// 'changed' fires once a file is indexed, but link resolution (what
		// populates resolvedLinks - what buildVaultGraph's edges come from)
		// "happens sometimes after a file has been indexed" per Obsidian's
		// own doc comment on this event. Without listening for 'resolved'
		// too, opening the view while a large vault is still resolving links
		// (e.g. right after Obsidian starts) can permanently miss edges: the
		// initial refresh() below runs against an incomplete resolvedLinks
		// map, and unless some other file happens to change afterward,
		// nothing ever triggers a re-check.
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.scheduleRefresh()));

		// Theme switches don't reload the plugin, so without this, colors
		// baked in at whatever theme was active when the view first opened
		// would just stay stale until the graph is rebuilt some other way.
		// A lightweight color-only refresh (GraphPane.refreshTheme), not the
		// full scheduleRefresh() - a theme switch shouldn't reset positions
		// or the current layout mode the way a vault-content change should.
		this.registerEvent(this.app.workspace.on('css-change', () => this.pane?.refreshTheme()));

		// User-reported: with Obsidian's "Adapt to system" appearance setting
		// (automatic light/dark switching driven by the OS, not a manual
		// toggle in Settings), colors stayed stuck at whatever theme was
		// active when the view last refreshed - e.g. a note's dark accent
		// color read as unreadably close to black once the OS switched to
		// dark mode, since the contrast check above ran against the *light*
		// background still cached in `this.theme`. 'css-change' above is
		// presumably tied to Obsidian's own manual appearance toggle, not to
		// the OS-level media-query change "Adapt to system" reacts to, so it
		// alone doesn't catch this - listening to the same
		// prefers-color-scheme query the OS (and Obsidian's "Adapt to
		// system" mode) itself uses is a signal independent of however
		// Obsidian's internal event wiring happens to handle that case.
		const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
		const handleColorSchemeChange = (): void => this.pane?.refreshTheme();
		colorSchemeQuery.addEventListener('change', handleColorSchemeChange);
		this.register(() => colorSchemeQuery.removeEventListener('change', handleColorSchemeChange));

		// User-reported: switching away to Obsidian's own core Graph View
		// (or any other tab) and back, or just opening a note, left this
		// view's graph blank until manually hitting "Center" - neither of
		// those changes this leaf's own pixel size, so ItemView's onResize()
		// below never fires for them. 'active-leaf-change' covers tab
		// switches directly; 'resize' is workspace's broader "a
		// WorkspaceItem resized or the layout changed" signal (its own doc
		// comment), which also catches opening a note. See
		// GraphPane.handleResize()'s docstring for why a resize+refresh is
		// needed at all here, not just a redundant safety net.
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.pane?.handleResize()));
		this.registerEvent(this.app.workspace.on('resize', () => this.pane?.handleResize()));
	}

	onClose(): Promise<void> {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.pane?.destroy();
		return Promise.resolve();
	}

	// Fires whenever this leaf's size changes, including a background tab
	// becoming active again - see GraphPane.handleResize()'s docstring for
	// why this matters (Sigma doesn't track its container's size on its
	// own).
	onResize(): void {
		this.pane?.handleResize();
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
	}

	private refresh(): void {
		this.pane?.setFiles(this.app.vault.getMarkdownFiles());
	}
}
