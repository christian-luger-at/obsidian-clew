import { App, PluginSettingTab, Setting } from 'obsidian';
import ClewPlugin from './main';
import { GraphPane } from './graph/graphPane';

export interface PinnedPosition {
	x: number;
	y: number;
}

/**
 * Every number here was previously a hardcoded constant scattered across
 * vaultGraph.ts/layoutRunner.ts/renderer.ts/radialLayout.ts/circularLayout.ts/
 * hierarchicalLayout.ts - user feedback comparing Clew's graph against
 * Obsidian's own core Graph View led to three rounds of manually re-tuning
 * node size alone in one session, which is exactly the friction a UI
 * setting removes. Grouped by what part of the rendering they affect, not
 * by which file they happen to live in.
 *
 * The controls for these live in the graph view itself (GraphPane's
 * "Appearance…" panel), not this plugin Settings tab - the user tunes them
 * while watching the graph react, which the Settings tab (a separate
 * screen, no live graph visible) can't offer. This interface and its
 * defaults still live here since ClewSettings is the persisted shape
 * (loadData()/saveData()) regardless of which UI edits it.
 */
export interface ClewAppearanceSettings {
	/** Plain-note node size at degree 0 (vaultGraph.ts's sizeNodesByDegree). */
	nodeBaseSize: number;
	/** Cover-image node size at degree 0 - kept separately tunable since NodeImageProgram needs a minimum footprint to stay recognizable. */
	nodeImageBaseSize: number;
	/** Multiplier on log(1 + degree) - how much bigger a hub node gets than a leaf. */
	nodeDegreeGrowth: number;
	/** ForceAtlas2's gravity setting (layoutRunner.ts) - pull toward the center. */
	gravity: number;
	/** ForceAtlas2's scalingRatio setting - overall repulsion/attraction force scale. */
	scalingRatio: number;
	/** sigma's labelRenderedSizeThreshold (renderer.ts) - on-screen node size a label must cross to render. */
	labelSizeThreshold: number;
	/** sigma's labelDensity (renderer.ts) - how many labels are allowed to render per area at a given zoom. */
	labelDensity: number;
	/** Distance between successive rings in the radial layout (radialLayout.ts). */
	radialRingSpacing: number;
	/** Ring radius in the circular layout (circularLayout.ts). */
	circularRadius: number;
	/** dagre's nodesep (hierarchicalLayout.ts) - spacing between nodes on the same rank. */
	hierarchicalNodeSpacing: number;
	/** dagre's ranksep (hierarchicalLayout.ts) - spacing between ranks. */
	hierarchicalRankSpacing: number;
	/**
	 * null = auto (the current theme's --graph-line, with an automatic
	 * contrast-safety fallback if that's too hard to see against the
	 * background - see theme.ts's ensureEdgeContrast()); otherwise a
	 * user-picked hex color that overrides both, for the rare theme where
	 * even the corrected color still doesn't look right to a given user.
	 */
	edgeColorOverride: string | null;
	/**
	 * How much of the theme's edge color survives theme.ts's
	 * softenTowardBackground() blend - 1 = unsoftened theme color, lower =
	 * more muted (search for its most-softened result that still clears
	 * softenTowardBackground()'s own separate, much lower contrast floor -
	 * see EDGE_SOFTEN_MIN_CONTRAST's docstring - so this is a ceiling on the
	 * softening, not a guaranteed exact result). User feedback: 0.6
	 * (theme.ts's own original default) still read as too prominent, 0.45
	 * better but asked to be user-tunable rather than another guessed
	 * constant - ignored entirely when edgeColorOverride is set, same as
	 * every other edge-color computation in theme.ts.
	 */
	edgeIntensity: number;
}

export const DEFAULT_APPEARANCE_SETTINGS: ClewAppearanceSettings = {
	nodeBaseSize: 1.2,
	nodeImageBaseSize: 2.5,
	nodeDegreeGrowth: 0.6,
	gravity: 0.3,
	scalingRatio: 10,
	labelSizeThreshold: 9,
	labelDensity: 0.5,
	radialRingSpacing: 120,
	circularRadius: 400,
	hierarchicalNodeSpacing: 40,
	hierarchicalRankSpacing: 80,
	edgeColorOverride: null,
	edgeIntensity: 0.45,
};

export interface ClewSettings {
	/**
	 * Manually dragged node positions, keyed by note path - GitHub issue
	 * #12. Not stored in the note's frontmatter (that would be file-content
	 * editing, a much bigger/riskier feature category per the product-vision
	 * doc's "Editability" backlog) - a position is presentation state, not
	 * note content, so it lives in the plugin's own data (this file, backed
	 * by Obsidian's loadData()/saveData()) instead.
	 */
	pinnedPositions: Record<string, PinnedPosition>;
	appearance: ClewAppearanceSettings;
}

export class ClewSettingTab extends PluginSettingTab {
	plugin: ClewPlugin;

	constructor(app: App, plugin: ClewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const count = Object.keys(this.plugin.settings.pinnedPositions).length;

		new Setting(containerEl)
			.setName('Pinned node positions')
			.setDesc(
				count === 0
					? 'No notes have a manually pinned position yet - drag a node in the graph view to pin it.'
					: `${count} note${count === 1 ? '' : 's'} currently ${count === 1 ? 'has' : 'have'} a pinned position.`,
			)
			.addButton((button) =>
				button
					.setButtonText('Clear all pinned positions')
					.setDisabled(count === 0)
					.onClick(async () => {
						this.plugin.settings.pinnedPositions = {};
						await this.plugin.saveSettings();
						// Without this, a previously-pinned node stayed frozen in
						// place in the already-open graph view until it was
						// closed and reopened - clearing the setting alone
						// doesn't retroactively un-fix a node already `fixed:
						// true` in the currently-rendered graph.
						GraphPane.getActive()?.clearPinnedPositions();
						this.display();
					}),
			);
	}
}
