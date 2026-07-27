export interface ThemeColors {
	graphColor: string;
	imageNodeColor: string;
	defaultEdgeColor: string;
	primaryPathColor: string;
	altPathColor: string;
	dimNodeColor: string;
	dimEdgeColor: string;
	matchColor: string;
	freshColorRgb: [number, number, number];
	staleColorRgb: [number, number, number];
}

function cssVar(computed: CSSStyleDeclaration, name: string, fallback: string): string {
	const value = computed.getPropertyValue(name).trim();
	return value || fallback;
}

function cssVarRgb(computed: CSSStyleDeclaration, name: string, fallback: [number, number, number]): [number, number, number] {
	const value = computed.getPropertyValue(name).trim();
	const parts = value.split(',').map((part) => Number(part.trim()));
	if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
		return [parts[0]!, parts[1]!, parts[2]!];
	}
	return fallback;
}

/**
 * Doc section 3.1: the graph should be theme-aware (light/dark, community
 * themes) instead of a fixed set of hex colors regardless of what the user
 * has chosen. sigma.js takes literal color strings per node/edge - it can't
 * reference CSS custom properties itself - so this resolves Obsidian's own
 * documented color variables (https://docs.obsidian.md/Reference/CSS+variables/Foundations/Colors)
 * once via getComputedStyle, and the caller re-reads on Obsidian's
 * 'css-change' workspace event (theme switches don't reload the plugin, so
 * nothing else would trigger a re-read - see GraphPane.refreshTheme()).
 *
 * Takes a reference element (rather than assuming `document.body`) so this
 * resolves correctly even inside an Obsidian popout window, which has its
 * own document/window context with potentially different computed styles.
 *
 * Falls back to the original hardcoded hex values (this project's initial
 * palette, before this was theme-aware) if a variable is missing - an old
 * Obsidian version, or in principle a theme that doesn't define Obsidian's
 * own documented variables - never renders with a missing/invalid color.
 */
export function readThemeColors(referenceEl: HTMLElement): ThemeColors {
	const computed = getComputedStyle(referenceEl);

	return {
		graphColor: cssVar(computed, '--color-purple', '#7c3aed'),
		imageNodeColor: cssVar(computed, '--color-orange', '#f59e0b'),
		defaultEdgeColor: cssVar(computed, '--text-faint', '#888888'),
		primaryPathColor: cssVar(computed, '--color-green', '#22c55e'),
		altPathColor: cssVar(computed, '--color-yellow', '#eab308'),
		dimNodeColor: cssVar(computed, '--text-faint', '#4b5563'),
		dimEdgeColor: cssVar(computed, '--text-faint', '#374151'),
		matchColor: cssVar(computed, '--color-green', '#22c55e'),
		freshColorRgb: cssVarRgb(computed, '--color-blue-rgb', [59, 130, 246]),
		staleColorRgb: cssVarRgb(computed, '--color-red-rgb', [239, 68, 68]),
	};
}
