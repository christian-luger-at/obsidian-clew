import { App, MarkdownPostProcessorContext, MarkdownRenderChild, TFile } from 'obsidian';
import { GraphPane } from './graphPane';
import { parseEmbedConfig } from './embedConfig';
import type ClewPlugin from '../main';

/**
 * GitHub issue #4, "Code-Fence Embed": a ```clew-graph code block renders
 * an inline ego-graph inside a note, centered on one note picked by name
 * (`node:`) out to a chosen number of hops (`hops:`, 1-3 - see
 * embedConfig.ts's parseEmbedConfig() for the exact syntax). First version
 * deliberately has no filter UI at all (see the issue's own "Abgrenzung")
 * - the embed is meant to read as a small, fixed illustration inside a
 * note, not a second interactive graph view.
 *
 * Owns one embedded GraphPane's lifecycle - a MarkdownRenderChild (not a
 * plain function callback) specifically so onunload() gets called and can
 * kill the pane's Sigma renderer: reading mode re-runs the code block
 * processor on every edit/scroll-into-view without this, leaving a growing
 * pile of live Sigma instances and event listeners behind each time,
 * exactly the leak StandaloneGraphView.onClose() already guards against for
 * the main view (see GraphPane.destroy()).
 */
class ClewGraphEmbed extends MarkdownRenderChild {
	private pane: GraphPane | null = null;
	private resizeObserver: ResizeObserver | null = null;

	constructor(
		containerEl: HTMLElement,
		private readonly app: App,
		private readonly plugin: ClewPlugin,
		private readonly source: string,
		private readonly ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
	}

	onload(): void {
		const config = parseEmbedConfig(this.source);
		if (!config.node) {
			this.showError('missing "node: <note name>".');
			return;
		}

		// getFirstLinkpathDest, not a plain path lookup - resolves the same
		// way a `[[wikilink]]` would (bare basename, a path relative to
		// ctx.sourcePath, or a full vault path), so `node:` in the fence can
		// be typed exactly like any other note reference in Obsidian rather
		// than requiring the note's full path.
		const file = this.app.metadataCache.getFirstLinkpathDest(config.node, this.ctx.sourcePath);
		if (!file || !(file instanceof TFile)) {
			this.showError(`note "${config.node}" not found.`);
			return;
		}

		const frameEl = this.containerEl.createDiv({ cls: 'clew-graph-embed-frame' });
		this.pane = new GraphPane(this.app, frameEl, this.plugin, { embedded: true });
		this.pane.setFiles(this.app.vault.getMarkdownFiles());
		this.pane.applyFocus(file, config.hops);

		// Sigma doesn't track its own container's size (see
		// GraphPane.handleResize()'s docstring) - the standalone view gets
		// resize signals from Obsidian's workspace events, which don't fire
		// for a plain div inside rendered markdown, so this embed needs its
		// own observer to catch the sidebar being toggled, the note pane
		// being resized, etc.
		this.resizeObserver = new ResizeObserver(() => this.pane?.handleResize());
		this.resizeObserver.observe(frameEl);
	}

	onunload(): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.pane?.destroy();
		this.pane = null;
	}

	private showError(message: string): void {
		this.containerEl.createDiv({ cls: 'clew-graph-embed-error', text: `clew-graph: ${message}` });
	}
}

/** Registers the ```clew-graph code-fence processor - called once from ClewPlugin.onload(). */
export function registerGraphEmbed(plugin: ClewPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor('clew-graph', (source, el, ctx) => {
		ctx.addChild(new ClewGraphEmbed(el, plugin.app, plugin, source, ctx));
	});
}
