/**
 * Doc section 3.1 ("Fundament"): visual encoding as view config - color by
 * a note property, size by a number. Kept separate from vaultGraph.ts
 * (topology) and graphPane.ts (Obsidian-dependent UI wiring, property
 * discovery, reducer/attribute application) so the actual color/size
 * computation stays pure and unit-testable, same boundary as
 * stagnation.ts/pathfinding.ts.
 *
 * Deliberately NOT formula support (arbitrary expressions) - a direct
 * property -> color/size mapping only, a conscious v1 scope decision (see
 * GitHub issue #1): no expression parser/evaluator, no new failure modes
 * from user-supplied code.
 */

// Chosen for visual separation, not colorblind-optimized perfection - "good
// enough to tell categories apart at a glance" is the actual bar here.
const CATEGORICAL_PALETTE = [
	'#ef4444',
	'#f97316',
	'#eab308',
	'#22c55e',
	'#06b6d4',
	'#3b82f6',
	'#8b5cf6',
	'#ec4899',
	'#64748b',
	'#84cc16',
];

/**
 * Assigns each distinct value a stable color from a fixed palette - values
 * are sorted before assigning colors (not assigned in first-seen order), so
 * the same set of values always maps to the same colors regardless of
 * iteration order, matching this project's other determinism guarantees
 * (see vaultGraph.ts's deterministicPosition).
 *
 * Exported (not just an internal step of colorByCategory) so the legend
 * (GitHub issue #13) can show the same value->color mapping currently
 * driving the graph, rather than recomputing or duplicating it.
 */
export function assignCategoryColors(values: Iterable<string>): Map<string, string> {
	const distinctValues = [...new Set(values)].sort((a, b) => a.localeCompare(b));

	const colorByValue = new Map<string, string>();
	distinctValues.forEach((value, i) => {
		colorByValue.set(value, CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]!);
	});
	return colorByValue;
}

/**
 * Nodes with an undefined value are simply absent from the returned map -
 * the caller decides the fallback.
 */
export function colorByCategory(valueByNode: Map<string, string | undefined>): Map<string, string> {
	const definedValues = [...valueByNode.values()].filter((value): value is string => value !== undefined);
	const colorByValue = assignCategoryColors(definedValues);

	const result = new Map<string, string>();
	for (const [node, value] of valueByNode) {
		if (value !== undefined) result.set(node, colorByValue.get(value)!);
	}
	return result;
}

const MIN_NODE_SIZE = 3;
const MAX_NODE_SIZE = 20;

/**
 * Normalizes a numeric property's value range (across whatever nodes have
 * one) into [MIN_NODE_SIZE, MAX_NODE_SIZE] - relative to the current graph,
 * same reasoning as stagnation.ts's staleness() being relative rather than
 * an absolute fixed scale (a "priority: 1-5" property and a "views: 1-50000"
 * property should both produce a readable size spread). Nodes without a
 * numeric value for the property are absent from the result - the caller
 * falls back to vaultGraph.ts's degree-based size for those.
 */
export function sizeByNumericValue(valueByNode: Map<string, number | undefined>): Map<string, number> {
	const numericValues = [...valueByNode.values()].filter(
		(value): value is number => typeof value === 'number' && Number.isFinite(value),
	);
	if (numericValues.length === 0) return new Map();

	const min = Math.min(...numericValues);
	const max = Math.max(...numericValues);

	const result = new Map<string, number>();
	for (const [node, value] of valueByNode) {
		if (typeof value !== 'number' || !Number.isFinite(value)) continue;
		const size = max === min ? (MIN_NODE_SIZE + MAX_NODE_SIZE) / 2 : MIN_NODE_SIZE + ((value - min) / (max - min)) * (MAX_NODE_SIZE - MIN_NODE_SIZE);
		result.set(node, size);
	}
	return result;
}
