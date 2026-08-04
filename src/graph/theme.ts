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
	/** `--background-primary` - the graph canvas's own background. Exposed (not just used internally for ensureContrast) so GraphPane can pass it to renderer.ts's hover-label background fix - see readThemeColors()'s docstring. */
	backgroundColor: string;
}

/**
 * Lazily-created, reused 1x1 canvas 2D context backing parseRgbString()
 * below - reused rather than a fresh canvas per call since this can run
 * several times per readThemeColors() call, and canvas creation isn't free.
 */
let colorProbeContext: CanvasRenderingContext2D | null = null;

/**
 * Parses *any* valid CSS color string into an [r, g, b] triple - null if
 * `value` isn't a valid CSS color at all. Originally a regex matching only
 * `rgb()`/`rgba()` (what cssVar's probe-based resolution was assumed to
 * always produce) plus `#rgb`/`#rrggbb` hex (added after
 * ClewAppearanceSettings.edgeColorOverride, straight from Obsidian's native
 * `Setting.addColorPicker()` - an `<input type="color">`, always hex -
 * turned out to need it too).
 *
 * Rewritten to this canvas-based approach after a real-world report of
 * still-black node/edge colors even on a fresh, correctly-timed
 * recomputation, on a theme this session had no reason to suspect: turned
 * out `getComputedStyle().color` does NOT always normalize to `rgb()`/
 * `rgba()` the way this file's own probe-element trick assumed - a user's
 * community theme defined its `--graph-*` variables via `oklch()`, and a
 * recent-enough Chromium (Obsidian is Electron/Chromium) serializes
 * `.color` back out in whatever modern CSS Color Module syntax the
 * declaration used, not always legacy `rgb()`. The regex silently failed
 * to match, `ensureContrast()`/`blendToward()` passed the untouched
 * `oklch(...)` string straight through, and sigma's own color parser -
 * which only understands `#hex`/`rgb()`/`rgba()` - fell back to its own
 * hardcoded opaque black for anything else, rendering as solid black
 * regardless of what the theme's colors actually were.
 *
 * A regex can only ever cover the color syntaxes it was written for
 * (already wrong twice - rgb-only, then rgb-or-hex); painting to a canvas
 * and reading the rasterized pixel back is the browser's own ground-truth
 * color resolution instead, so it's correct for oklch/lab/lch/color()/
 * named colors/anything CSS-valid, present or future, with no further
 * cases to special-case here.
 */
function parseRgbString(value: string): [number, number, number] | null {
	if (!colorProbeContext) {
		// Obsidian's global createEl() (not document.createElement()) - this
		// canvas is a permanent, detached, module-level utility buffer,
		// deliberately never appended to any document.
		const canvas = createEl('canvas');
		canvas.width = 1;
		canvas.height = 1;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;
		colorProbeContext = ctx;
	}
	const ctx = colorProbeContext;
	// fillStyle silently no-ops (keeps its previous value) when assigned an
	// unparseable string, rather than throwing - set a recognizable
	// sentinel first so an invalid `value` is detectable as "unchanged"
	// instead of misread as that sentinel's own color.
	const UNPARSEABLE_SENTINEL = '#010203';
	ctx.fillStyle = UNPARSEABLE_SENTINEL;
	ctx.fillStyle = value;
	if (ctx.fillStyle === UNPARSEABLE_SENTINEL) return null;
	ctx.clearRect(0, 0, 1, 1);
	ctx.fillRect(0, 0, 1, 1);
	const pixel = ctx.getImageData(0, 0, 1, 1).data;
	return [pixel[0]!, pixel[1]!, pixel[2]!];
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

/**
 * Default for readThemeColors()'s `edgeIntensity` param (see
 * ClewAppearanceSettings.edgeIntensity, settings.ts, which is what
 * GraphPane actually passes - this only matters for a caller that doesn't).
 *
 * User feedback: edges at the theme's raw `--graph-line` intensity read as
 * too prominent/heavy against the rest of the graph - GraphPane's
 * resolvedEdgeColor() blends *whichever* color it resolves to (the theme's
 * or the user's edgeColorOverride) toward the background by this much (see
 * blendToward() - 1 = unblended, 0 = fully the background). NOT applied
 * here to defaultEdgeColor directly (an earlier version did): baking it in
 * here meant it silently stopped doing anything the moment
 * edgeColorOverride was set, since resolvedEdgeColor() then uses the
 * override verbatim and never even reads defaultEdgeColor - reported as
 * "edge intensity doesn't work anymore once you set a color". Applying it
 * once, after the override-or-default choice is already made, is what
 * makes it affect either one. Deliberately a *literal* blend, not clamped
 * to any minimum-contrast floor the way ensureContrast() protects the
 * raw theme color: an earlier version did clamp this, meant to protect a
 * hardcoded constant from being *too* washed out on an unlucky theme -
 * once it became a user-facing 0-1 slider, that same clamp fought the
 * user's own explicit choice instead (reported: edges still visible at
 * the slider's 0 end, since the clamp silently pulled it back up to
 * whatever the floor demanded). A setting the user is dialing on purpose,
 * all the way to "off" if they want, isn't the accidental-invisibility
 * risk ensureContrast() exists for.
 */
const EDGE_INTENSITY_FACTOR = 0.45;

/**
 * Blends `color` toward `backgroundColor` - `factor` is how much of the
 * original color remains (0 = fully the background, 1 = fully the original
 * color). Produces an opaque rgb() triple, not an alpha-transparent one -
 * see DIM_FACTOR's docstring for why.
 *
 * Exported (not just used internally for dimNodeColor/dimEdgeColor) so
 * GraphPane's hover reducer can blend a node/edge's *own* color toward the
 * dim floor by a hop-distance-graded factor instead of only ever producing
 * the single flat dimNodeColor/dimEdgeColor this file computes at factor
 * DIM_FACTOR - "backgroundColor" here just means "the color being blended
 * toward", not necessarily the canvas background specifically.
 */
export function blendToward(color: string, backgroundColor: string, factor: number): string {
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
 * against its background - edges and node fills are exactly that
 * (informational graphics, not decoration), so this reuses that number
 * rather than picking one by eye. Not WCAG's higher 4.5:1 text threshold -
 * a thin line or a small dot doesn't need to be as legible as text, and
 * requiring that much would make the graph look heavier than most themes
 * intend.
 */
const MIN_CONTRAST = 3;

/**
 * User feedback: a theme-derived color ("--graph-line", "--graph-node", …)
 * can render with too little contrast against the background to actually
 * see - a real risk this file's own docstring already flagged (unlike the
 * "Foundation" colors every theme has to get right to be usable at all,
 * the `--graph-*` variables are optional and easy for a theme to leave
 * under-tuned). Originally edge-only (ensureEdgeContrast) - generalized on
 * request to also guard the node-color defaults (graphColor,
 * imageNodeColor, matchColor below), which had no contrast check at all
 * despite the identical risk. Rather than trust the theme unconditionally,
 * this measures the actual rendered contrast against `--background-primary`
 * and substitutes a guaranteed-visible neutral gray - picked light or dark
 * based on the background's own luminance, not a single fixed color, so it
 * stays visible against both light and dark themes - if the theme's own
 * value falls short.
 *
 * Only ever loosens what the theme already provides (never overrides a
 * theme color that already has enough contrast), and is fully bypassed by
 * GraphPane when the user sets an explicit color override
 * (ClewAppearanceSettings.edgeColorOverride/nodeColorOverride) - this is a
 * safety net for the "no override set" default path only.
 *
 * Always returns a `rgb(...)` string reconstructed from the already-parsed
 * triple, never the original `color` argument verbatim - even on the
 * "contrast is already fine" path (an earlier version returned `color`
 * itself there). Contrast and *renderability* are separate concerns: a
 * theme's `--graph-node`/`--graph-line` can have perfectly good contrast
 * while still being a syntax sigma's own color parser can't render at all
 * (a real report - a community theme's oklch() colors measured as
 * high-contrast, so this function correctly left them untouched, but
 * sigma's parser only understands `#hex`/`rgb()`/`rgba()` and fell back to
 * its own hardcoded black regardless of the contrast check ever having
 * passed). parseRgbString() above already resolves *any* valid CSS color
 * to concrete RGB numbers via canvas rasterization - reusing that result
 * to always rebuild a plain `rgb()` string, instead of only doing so on
 * the "contrast failed" fallback path, makes every return sigma-safe.
 */
function ensureContrast(color: string, backgroundColor: string): string {
	const colorRgb = parseRgbString(color);
	const backgroundRgb = parseRgbString(backgroundColor);
	if (!colorRgb || !backgroundRgb) return color;
	if (contrastRatio(colorRgb, backgroundRgb) >= MIN_CONTRAST) return `rgb(${colorRgb[0]}, ${colorRgb[1]}, ${colorRgb[2]})`;
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
 * `graphColor`, `imageNodeColor`, `defaultEdgeColor`, and `matchColor`
 * additionally go through ensureContrast() below - unlike the
 * "Foundation" colors every theme has to get right to be usable at all,
 * the `--graph-*` variables are easy for a theme to leave under-tuned,
 * and a too-low-contrast color is a real (reported) failure mode, first
 * found on edges and then generalized to nodes too. `defaultEdgeColor` is
 * deliberately *not* also blended toward the background here for
 * `edgeIntensity` (unlike an earlier version) - GraphPane's
 * resolvedEdgeColor() does that once, after picking between this and
 * edgeColorOverride, so the setting actually affects either one instead
 * of only the theme default. `dimEdgeColor` below still reads
 * `edgeIntensity` directly (for its own, separate "never dim to something
 * more prominent than the resting intensity" floor).
 */
export function readThemeColors(referenceEl: HTMLElement, edgeIntensity: number = EDGE_INTENSITY_FACTOR): ThemeColors {
	const computed = getComputedStyle(referenceEl);
	const probe = referenceEl.createSpan();

	const cssVar = (name: string, fallback: string): string => {
		const raw = computed.getPropertyValue(name).trim();
		if (!raw) return fallback;
		probe.style.color = raw;
		return getComputedStyle(probe).color || fallback;
	};

	// Resolved first (not inline below) since ensureContrast() also
	// needs it - computed once, not twice.
	const backgroundColor = cssVar('--background-primary', '#ffffff');

	const colors: ThemeColors = {
		graphColor: ensureContrast(cssVar('--graph-node', '#7c3aed'), backgroundColor),
		// Obsidian's graph doesn't have a "note with a cover image" concept
		// of its own - --graph-node-attachment (its color for non-note
		// files, e.g. images/PDFs attached in the vault) is the closest
		// existing semantic match for "this node represents visual/media
		// content", reused here rather than a generic accent color.
		imageNodeColor: ensureContrast(cssVar('--graph-node-attachment', '#f59e0b'), backgroundColor),
		// sigma.js's own default labelColor is a hardcoded '#000' (see
		// settings.ts in the sigma package) - never overridden before this,
		// so every node label rendered as plain black text regardless of
		// theme. Unreadable in dark mode, most visibly on hover (GitHub
		// issue #9's forceLabel on neighbor nodes, which shows labels that
		// otherwise wouldn't render at that zoom level at all).
		labelColor: cssVar('--graph-text', '#dcddde'),
		defaultEdgeColor: ensureContrast(cssVar('--graph-line', '#888888'), backgroundColor),
		// ensureContrast() here isn't primarily for its contrast-safety
		// fallback (--color-green/--color-yellow are Obsidian "Foundation"
		// variables every theme has to get right) - it's what normalizes
		// the result to a sigma-renderable rgb() string. Same latent risk
		// as graphColor/defaultEdgeColor: these feed WebGL node/edge color
		// attributes directly (applyHighlight() in graphPane.ts) and
		// sigma's own color parser doesn't understand oklch()/lab()/etc.
		primaryPathColor: ensureContrast(cssVar('--color-green', '#22c55e'), backgroundColor),
		altPathColor: ensureContrast(cssVar('--color-yellow', '#eab308'), backgroundColor),
		dimNodeColor: blendToward(cssVar('--text-faint', '#4b5563'), backgroundColor, DIM_FACTOR),
		// min(DIM_FACTOR, edgeIntensity), not DIM_FACTOR alone: a low
		// edgeIntensity setting can already put the *resting* edge color
		// fainter than DIM_FACTOR's usual dim floor would be on its own -
		// without this, hovering (which blends toward dimEdgeColor) would
		// make an edge *more* prominent than it already was at rest, which
		// reads as backwards for a "dim the rest" interaction. Whichever is
		// smaller wins, so the dim floor is never above the edge's own
		// configured intensity.
		dimEdgeColor: blendToward(cssVar('--text-faint', '#374151'), backgroundColor, Math.min(DIM_FACTOR, edgeIntensity)),
		// --graph-node-focused: the color Obsidian's own graph uses for
		// "this is the node currently being interacted with" - the same
		// concept as Clew's hover-highlight (#9), search match, and
		// stagnation-cluster focus, all of which reuse this one color.
		matchColor: ensureContrast(cssVar('--graph-node-focused', '#22c55e'), backgroundColor),
		backgroundColor,
	};

	probe.remove();
	return colors;
}
