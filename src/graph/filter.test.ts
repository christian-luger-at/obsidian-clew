import { describe, it, expect } from 'vitest';
import { evaluateFilters, FilterPreset, isAnyFilterEnabled, NoteFilterFacts } from './filter';
import { GroupCriterion } from './nodeGroups';

function facts(overrides: Partial<NoteFilterFacts> = {}): NoteFilterFacts {
	return {
		label: 'Note',
		folder: '',
		content: '',
		tags: [],
		frontmatter: {},
		clusterStaleness: null,
		structuralDeviation: null,
		betweenness: null,
		pageRank: null,
		isolatedComponent: null,
		communityId: null,
		semanticClusterId: null,
		nodeKind: null,
		mtime: Date.now(),
		degree: 0,
		exists: true,
		...overrides,
	};
}

function preset(overrides: Partial<FilterPreset> = {}): FilterPreset {
	return {
		id: 'f1',
		name: 'Filter',
		enabled: true,
		criteria: [],
		...overrides,
	};
}

describe('isAnyFilterEnabled', () => {
	it('is false with no presets', () => {
		expect(isAnyFilterEnabled([])).toBe(false);
	});

	it('is false when every preset is disabled', () => {
		expect(isAnyFilterEnabled([preset({ enabled: false })])).toBe(false);
	});

	it('is true once at least one preset is enabled', () => {
		expect(isAnyFilterEnabled([preset({ enabled: false }), preset({ enabled: true })])).toBe(true);
	});
});

describe('evaluateFilters', () => {
	const filenameCriterion = (query: string): GroupCriterion => ({ type: 'filename', query });

	it('matches notes against a single enabled filter', () => {
		const presets = [preset({ criteria: [filenameCriterion('proj')] })];
		const factsByNode = new Map([
			['a', facts({ label: 'My Project' })],
			['b', facts({ label: 'Unrelated' })],
		]);

		const result = evaluateFilters(factsByNode, presets, 'or');
		expect(result.has('a')).toBe(true);
		expect(result.has('b')).toBe(false);
	});

	it('ANDs across a single filter’s own criteria', () => {
		const presets = [preset({ criteria: [{ type: 'tag', tags: ['#project'] }, { type: 'minLinks', count: 2 }] })];
		expect(evaluateFilters(new Map([['a', facts({ tags: ['#project'], degree: 3 })]]), presets, 'or').has('a')).toBe(true);
		expect(evaluateFilters(new Map([['a', facts({ tags: ['#project'], degree: 0 })]]), presets, 'or').has('a')).toBe(false);
	});

	it('combineMode "or": a note shows if it matches any enabled filter', () => {
		const presets = [
			preset({ id: 'a', criteria: [filenameCriterion('alpha')] }),
			preset({ id: 'b', criteria: [filenameCriterion('beta')] }),
		];
		const factsByNode = new Map([
			['a', facts({ label: 'Alpha note' })],
			['b', facts({ label: 'Beta note' })],
			['c', facts({ label: 'Gamma note' })],
		]);

		const result = evaluateFilters(factsByNode, presets, 'or');
		expect(result.has('a')).toBe(true);
		expect(result.has('b')).toBe(true);
		expect(result.has('c')).toBe(false);
	});

	it('combineMode "and": a note shows only if it matches every enabled filter', () => {
		const presets = [
			preset({ id: 'a', criteria: [{ type: 'tag', tags: ['#project'] }] }),
			preset({ id: 'b', criteria: [{ type: 'minLinks', count: 2 }] }),
		];
		const factsByNode = new Map([
			['both', facts({ tags: ['#project'], degree: 3 })],
			['tagOnly', facts({ tags: ['#project'], degree: 0 })],
			['linksOnly', facts({ tags: [], degree: 3 })],
		]);

		const result = evaluateFilters(factsByNode, presets, 'and');
		expect(result.has('both')).toBe(true);
		expect(result.has('tagOnly')).toBe(false);
		expect(result.has('linksOnly')).toBe(false);
	});

	it('ignores disabled filters', () => {
		const presets = [preset({ enabled: false, criteria: [filenameCriterion('alpha')] })];
		const result = evaluateFilters(new Map([['a', facts({ label: 'Alpha note' })]]), presets, 'or');
		expect(result.has('a')).toBe(false);
	});

	it('a filter with no criteria yet matches nothing', () => {
		const presets = [preset({ criteria: [] })];
		const result = evaluateFilters(new Map([['a', facts({ label: 'Anything' })]]), presets, 'or');
		expect(result.has('a')).toBe(false);
	});
});
