import { App, MarkdownPostProcessorContext, MarkdownRenderChild, setIcon, setTooltip, TFile } from 'obsidian';
import { GraphPane } from './graphPane';
import { parseEmbedConfig } from './embedConfig';
import type ClewPlugin from '../main';

/**
 * GitHub issue #4, "Code-Fence Embed": a ```clew-graph code block renders
 * an inline ego-graph inside a note, centered on one note picked by name
 * (`node:`) out to a chosen number of hops (`hops:`, 1-3), sized by
 * `width:`/`height:` (falling back to full width / 16:9 - see
 * embedConfig.ts's parseEmbedConfig() for the exact syntax of all four),
 * with an optional manual `refresh:` button. Rendered as Radial layout
 * (not Force) with the center note ringed/labeled, a caption above the
 * frame, and a softer frame than the graph view's own (user feedback: "die
 * Darstellung [...] ist nicht schön" - see this class's `render()` and
 * styles.css's `.clew-graph-embed-*` rules). First version deliberately has
 * no filter UI at all (see the issue's own "Abgrenzung") and never carries
 * over the user's real Filter/Color & size/pinned-node state (user
 * feedback: "Es dürfen keine Filter, Colors oder gespeicherte Positionen
 * übernommen werden" - see GraphPane's own `embedded` field docstring for
 * how) - the embed is meant to read as a small, self-contained illustration
 * inside a note, not a miniature of whatever the main graph view happens to
 * be showing right now.
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

		// User feedback: "die Darstellung [...] ist nicht schön" - a short
		// caption above the frame (the note's own name + hop count) gives
		// context at a glance, without needing to open the code fence to
		// find out what it's even centered on.
		this.containerEl.createDiv({
			cls: 'clew-graph-embed-caption',
			text: `${file.basename} · ${config.hops} ${config.hops === 1 ? 'hop' : 'hops'}`,
		});

		const frameEl = this.containerEl.createDiv({ cls: 'clew-graph-embed-frame' });
		// Only touches whichever dimension the fence actually set - the
		// other stays governed by styles.css's own default (full width,
		// 16:9 via `aspect-ratio`, see .clew-graph-embed-frame's own
		// comment for why a fixed default here would break that).
		if (config.width) frameEl.style.width = config.width;
		if (config.height) frameEl.style.height = config.height;

		this.pane = new GraphPane(this.app, frameEl, this.plugin, { embedded: true });
		const pane = this.pane;
		// Radial (centered on `file`), not Force - same feedback as the
		// caption above: a small embed reads far better as clean concentric
		// rings around the note it's actually about than as Force's
		// randomly-scattered settle, and it's what draws the center-note
		// highlight ring below "for free" (see setRadialFocus()'s own
		// docstring). `highlightCenter`/`fitCamera` are embed-only options -
		// the real Focus panel's own look is untouched (see applyFocus()'s
		// docstring).
		const render = (): void => {
			pane.setFiles(this.app.vault.getMarkdownFiles());
			pane.setRadialFocus(file.path);
			pane.applyFocus(file, config.hops, { highlightCenter: true, fitCamera: true });
		};
		render();

		if (config.showRefreshButton) {
			const refreshButton = frameEl.createEl('button', { cls: ['clickable-icon', 'clew-graph-embed-refresh'] });
			setIcon(refreshButton, 'refresh-cw');
			setTooltip(refreshButton, 'Refresh');
			refreshButton.addEventListener('click', render);
		}

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
