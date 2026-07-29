export interface ThemeColors {
	graphColor: string;
	imageNodeColor: string;
	labelColor: string;
	defaultEdgeColor: string;
	primaryPathColor: string;
	altPathColor: string;
	dimNodeColor: string;
	dimEdgeColor: string;
	matchColor: string;
	freshColorRgb: [number, number, number];
	staleColorRgb: [number, number, number];
	/** `--background-primary` - the graph canvas's own background. Exposed (not just used internally for ensureEdgeContrast) so GraphPane can pass it to renderer.ts's hover-label background fix - see readThemeColors()'s docstring. */
	backgroundColor: string;
}

function cssVarRgb(computed: CSSStyleDeclaration, name: string, fallback: [number, number, number]): [number, number, number] {
	const value = computed.getPropertyValue(name).trim();
	const parts = value.split(',').map((part) => Number(part.trim()));
	if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
		return [parts[0]!, parts[1]!, parts[2]!];
	}
	return fallback;
}

/** Parses an `rgb()`/`rgba()` string (what cssVar's probe-based resolution always produces) into a [r, g, b] triple - null if it isn't one (e.g. a raw hex string, which callers here don't pass through this path). */
function parseRgbString(value: string): [number, number, number] | null {
	const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * User feedback: the "dim everything but the focused node/neighbors" look
 * (hover, search, path result, stagnation-cluster focus - all share this
 * one color) wasn't faded enough, still reading as fairly prominent. First
 * attempt used `rgba()` transparency (sigma's color *parser* accepts it,
 * confirmed from source) rather than a different solid color - didn't
 * actually render any lighter, confirmed against a real screenshot: sigma's
 * default WebGL node program apparently doesn't alpha-blend node fills
 * against the canvas the way a 2D-canvas `rgba()` fill normally would, so
 * the alpha channel was silently a no-op. blendToward() instead precomputes
 * a genuinely different *opaque* RGB color - a real mix toward the canvas
 * background - which doesn't depend on the renderer's alpha-blending
 * behavior at all, only on it drawing the literal color it's given.
 *
 * 0.08 (next attempt after the fully-opaque original) overshot the other
 * way - user feedback: dimmed nodes/edges read as effectively hidden, not
 * merely toned down ("sollen nicht ausgeblendet werden, sondern visuell
 * stark zurückgenommen"). Dimmed elements need to stay recognizable as
 * actual nodes/edges - just clearly de-emphasized relative to the
 * hovered/matched focus - not fade to the point of disappearing.
 */
const DIM_FACTOR = 0.35;

/** Blends `color` toward `backgroundColor` - `factor` is how much of the original color remains (0 = fully the background, 1 = fully the original color). Produces an opaque rgb() triple, not an alpha-transparent one - see DIM_FACTOR's docstring for why. */
function blendToward(color: string, backgroundColor: string, factor: number): string {
	const colorRgb = parseRgbString(color);
	const backgroundRgb = parseRgbString(backgroundColor);
	if (!colorRgb || !backgroundRgb) return color;
	const mix = (channel: number, backgroundChannel: number): number => Math.round(channel * factor + backgroundChannel * (1 - factor));
	return `rgb(${mix(colorRgb[0], backgroundRgb[0])}, ${mix(colorRgb[1], backgroundRgb[1])}, ${mix(colorRgb[2], backgroundRgb[2])})`;
}

/** WCAG relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
	const linearize = (channel: number): number => {
		const s = channel / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio) - 1 (identical) to 21 (black on white). */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
	const l1 = relativeLuminance(a);
	const l2 = relativeLuminance(b);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG 1.4.11 ("non-text contrast") recommends 3:1 for graphical/UI content
 * against its background - edges are exactly that (informational graphics,
 * not decoration), so this reuses that number rather than picking one by
 * eye. Not WCAG's higher 4.5:1 text threshold - a thin line doesn't need to
 * be as legible as text, and requiring that much would make edges look
 * heavier than most themes intend.
 */
const MIN_EDGE_CONTRAST = 3;

/**
 * User feedback: a theme-derived edge color ("--graph-line") can render
 * with too little contrast against the background to actually see - a real
 * risk this file's own docstring already flagged (unlike the "Foundation"
 * colors every theme has to get right to be usable at all, `--graph-line`
 * is optional and easy for a theme to leave under-tuned). Rather than trust
 * the theme unconditionally, this measures the actual rendered contrast
 * against `--background-primary` and substitutes a guaranteed-visible
 * neutral gray - picked light or dark based on the background's own
 * luminance, not a single fixed color, so it stays visible against both
 * light and dark themes - if the theme's own value falls short.
 *
 * Only ever loosens what the theme already provides (never overrides a
 * theme color that already has enough contrast), and is fully bypassed by
 * GraphPane when the user sets an explicit edge-color override
 * (ClewAppearanceSettings.edgeColorOverride) - this is a safety net for the
 * "no override set" default path only.
 */
function ensureEdgeContrast(edgeColor: string, backgroundColor: string): string {
	const edgeRgb = parseRgbString(edgeColor);
	const backgroundRgb = parseRgbString(backgroundColor);
	if (!edgeRgb || !backgroundRgb) return edgeColor;
	if (contrastRatio(edgeRgb, backgroundRgb) >= MIN_EDGE_CONTRAST) return edgeColor;
	return relativeLuminance(backgroundRgb) > 0.5 ? '#4b5563' : '#9ca3af';
}

/**
 * Doc section 3.1: the graph should be theme-aware (light/dark, community
 * themes) instead of a fixed set of hex colors regardless of what the user
 * has chosen. sigma.js takes literal color strings per node/edge - it can't
 * reference CSS custom properties itself - so this resolves Obsidian's own
 * documented color variables once via getComputedStyle, and the caller
 * re-reads on Obsidian's 'css-change' workspace event (theme switches don't
 * reload the plugin, so nothing else would trigger a re-read - see
 * GraphPane.refreshTheme()).
 *
 * Prefers Obsidian's own dedicated Graph View variables
 * (https://docs.obsidian.md/Reference/CSS+variables/Plugins/Graph -
 * `--graph-node`, `--graph-line`, `--graph-text`, `--graph-node-focused`,
 * `--graph-node-attachment`) over the generic accent colors this file used
 * before - user feedback comparing Clew's graph side-by-side with
 * Obsidian's own core Graph View ("der Obsidian-Graph ist viel gefälliger")
 * pointed at exactly this: a fixed, fully-saturated accent purple/orange
 * and a generic muted-text edge color don't match what users are used to
 * seeing, whereas the dedicated graph variables are the *exact* colors
 * (and exact light/dark/community-theme adaptation) Obsidian's own graph
 * renders with. No dedicated variable exists for Clew-specific concepts
 * Obsidian's core graph doesn't have (path-finding's primary/alt route,
 * the stagnation heatmap, "dimmed" as opposed to simply absent) - those
 * keep their previous sources.
 *
 * Takes a reference element (rather than assuming `document.body`) so this
 * resolves correctly even inside an Obsidian popout window, which has its
 * own document/window context with potentially different computed styles.
 *
 * Resolves each variable through a real `color` property assignment (a
 * throwaway probe element) rather than returning `getPropertyValue`'s raw
 * text directly: a CSS custom property is opaque text to the browser, so
 * its computed value keeps whatever color syntax the theme originally used
 * (hex, `hsl()`, `color-mix()`, a named color, ...) even after any nested
 * `var()` references are substituted. sigma's own color parser only
 * understands `#hex` and `rgb()`/`rgba()` (confirmed by reading sigma's
 * `parseColor` source) and silently falls back to opaque black for
 * anything else instead of erroring - a real risk for `--graph-*`, which,
 * unlike the `--color-*`/`--text-*` variables already in use here, aren't
 * documented as being plain hex. Assigning the raw value to a real `color`
 * property and reading the computed value back always normalizes to
 * `rgb()`/`rgba()`, regardless of the original syntax.
 *
 * Falls back to the original hardcoded hex values (this project's initial
 * palette, before this was theme-aware) if a variable is missing - an old
 * Obsidian version, or in principle a theme that doesn't define Obsidian's
 * own documented variables - never renders with a missing/invalid color.
 *
 * `defaultEdgeColor` additionally goes through ensureEdgeContrast() below -
 * unlike the "Foundation" colors every theme has to get right to be usable
 * at all, `--graph-line` is easy for a theme to leave under-tuned, and a
 * low-contrast edge color is a real (reported) failure mode. GraphPane
 * layers a user-settable override on top of this (see
 * ClewAppearanceSettings.edgeColorOverride) for the rare case even the
 * contrast-corrected color still doesn't look right to a given user.
 */
export function readThemeColors(referenceEl: HTMLElement): ThemeColors {
	const computed = getComputedStyle(referenceEl);
	const probe = referenceEl.ownerDocument.createElement('span');
	referenceEl.appendChild(probe);

	const cssVar = (name: string, fallback: string): string => {
		const raw = computed.getPropertyValue(name).trim();
		if (!raw) return fallback;
		probe.style.color = raw;
		return getComputedStyle(probe).color || fallback;
	};

	// Resolved first (not inline below) since ensureEdgeContrast() also
	// needs it - computed once, not twice.
	const backgroundColor = cssVar('--background-primary', '#ffffff');

	const colors: ThemeColors = {
		graphColor: cssVar('--graph-node', '#7c3aed'),
		// Obsidian's graph doesn't have a "note with a cover image" concept
		// of its own - --graph-node-attachment (its color for non-note
		// files, e.g. images/PDFs attached in the vault) is the closest
		// existing semantic match for "this node represents visual/media
		// content", reused here rather than a generic accent color.
		imageNodeColor: cssVar('--graph-node-attachment', '#f59e0b'),
		// sigma.js's own default labelColor is a hardcoded '#000' (see
		// settings.ts in the sigma package) - never overridden before this,
		// so every node label rendered as plain black text regardless of
		// theme. Unreadable in dark mode, most visibly on hover (GitHub
		// issue #9's forceLabel on neighbor nodes, which shows labels that
		// otherwise wouldn't render at that zoom level at all).
		labelColor: cssVar('--graph-text', '#dcddde'),
		defaultEdgeColor: ensureEdgeContrast(cssVar('--graph-line', '#888888'), backgroundColor),
		primaryPathColor: cssVar('--color-green', '#22c55e'),
		altPathColor: cssVar('--color-yellow', '#eab308'),
		dimNodeColor: blendToward(cssVar('--text-faint', '#4b5563'), backgroundColor, DIM_FACTOR),
		dimEdgeColor: blendToward(cssVar('--text-faint', '#374151'), backgroundColor, DIM_FACTOR),
		// --graph-node-focused: the color Obsidian's own graph uses for
		// "this is the node currently being interacted with" - the same
		// concept as Clew's hover-highlight (#9), search match, and
		// stagnation-cluster focus, all of which reuse this one color.
		matchColor: cssVar('--graph-node-focused', '#22c55e'),
		freshColorRgb: cssVarRgb(computed, '--color-blue-rgb', [59, 130, 246]),
		staleColorRgb: cssVarRgb(computed, '--color-red-rgb', [239, 68, 68]),
		backgroundColor,
	};

	probe.remove();
	return colors;
}
