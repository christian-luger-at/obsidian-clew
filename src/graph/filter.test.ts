import { describe, it, expect } from 'vitest';
import { EMPTY_FILTER_QUERY, evaluateQuery, isEmptyQuery, matchesQuery, NoteFilterFacts } from './filter';

function facts(overrides: Partial<NoteFilterFacts> = {}): NoteFilterFacts {
	return {
		label: 'Note',
		tags: [],
		frontmatter: {},
		mtime: Date.now(),
		degree: 0,
		...overrides,
	};
}

describe('isEmptyQuery', () => {
	it('is true for the default query', () => {
		expect(isEmptyQuery(EMPTY_FILTER_QUERY)).toBe(true);
	});

	it('is false once text is set', () => {
		expect(isEmptyQuery({ ...EMPTY_FILTER_QUERY, text: 'foo' })).toBe(false);
	});

	it('is false once a tag is selected', () => {
		expect(isEmptyQuery({ ...EMPTY_FILTER_QUERY, tags: ['#project'] })).toBe(false);
	});

	it('stays true for a property row with no value typed yet', () => {
		expect(isEmptyQuery({ ...EMPTY_FILTER_QUERY, properties: [{ key: 'status', value: '' }] })).toBe(true);
	});

	it('is false once a property row has a value', () => {
		expect(isEmptyQuery({ ...EMPTY_FILTER_QUERY, properties: [{ key: 'status', value: 'done' }] })).toBe(false);
	});

	it('is false once staleDays is set', () => {
		expect(isEmptyQuery({ ...EMPTY_FILTER_QUERY, staleDays: 30 })).toBe(false);
	});

	it('is false once minDegree is set', () => {
		expect(isEmptyQuery({ ...EMPTY_FILTER_QUERY, minDegree: 5 })).toBe(false);
	});
});

describe('matchesQuery', () => {
	it('matches everything against the empty query', () => {
		expect(matchesQuery(facts({ label: 'Anything' }), EMPTY_FILTER_QUERY)).toBe(true);
	});

	it('matches text case-insensitively as a substring', () => {
		const query = { ...EMPTY_FILTER_QUERY, text: 'proj' };
		expect(matchesQuery(facts({ label: 'My Project' }), query)).toBe(true);
		expect(matchesQuery(facts({ label: 'Unrelated' }), query)).toBe(false);
	});

	it('matches a note with any one of several selected tags (OR)', () => {
		const query = { ...EMPTY_FILTER_QUERY, tags: ['#project', '#urgent'] };
		expect(matchesQuery(facts({ tags: ['#project'] }), query)).toBe(true);
		expect(matchesQuery(facts({ tags: ['#urgent'] }), query)).toBe(true);
		expect(matchesQuery(facts({ tags: ['#todo'] }), query)).toBe(false);
	});

	it('matches a frontmatter property as a case-insensitive substring', () => {
		const query = { ...EMPTY_FILTER_QUERY, properties: [{ key: 'status', value: 'do' }] };
		expect(matchesQuery(facts({ frontmatter: { status: 'Done' } }), query)).toBe(true);
		expect(matchesQuery(facts({ frontmatter: { status: 'Archived' } }), query)).toBe(false);
		expect(matchesQuery(facts({ frontmatter: {} }), query)).toBe(false);
	});

	it('requires every property row to match (AND across rows)', () => {
		const query = {
			...EMPTY_FILTER_QUERY,
			properties: [
				{ key: 'status', value: 'done' },
				{ key: 'priority', value: '5' },
			],
		};
		expect(matchesQuery(facts({ frontmatter: { status: 'done', priority: 5 } }), query)).toBe(true);
		expect(matchesQuery(facts({ frontmatter: { status: 'done', priority: 1 } }), query)).toBe(false);
	});

	it('ignores a property row with no value typed yet', () => {
		const query = { ...EMPTY_FILTER_QUERY, properties: [{ key: 'status', value: '' }] };
		expect(matchesQuery(facts({ frontmatter: {} }), query)).toBe(true);
	});

	it('excludes a note edited more recently than staleDays', () => {
		const query = { ...EMPTY_FILTER_QUERY, staleDays: 30 };
		const stale = facts({ mtime: Date.now() - 60 * 24 * 60 * 60 * 1000 });
		const fresh = facts({ mtime: Date.now() - 1 * 24 * 60 * 60 * 1000 });
		expect(matchesQuery(stale, query)).toBe(true);
		expect(matchesQuery(fresh, query)).toBe(false);
	});

	it('excludes a note below minDegree', () => {
		const query = { ...EMPTY_FILTER_QUERY, minDegree: 3 };
		expect(matchesQuery(facts({ degree: 5 }), query)).toBe(true);
		expect(matchesQuery(facts({ degree: 1 }), query)).toBe(false);
	});

	it('requires every active criterion type to match (AND across types)', () => {
		const query = { ...EMPTY_FILTER_QUERY, tags: ['#project'], minDegree: 2 };
		expect(matchesQuery(facts({ tags: ['#project'], degree: 3 }), query)).toBe(true);
		expect(matchesQuery(facts({ tags: ['#project'], degree: 0 }), query)).toBe(false);
		expect(matchesQuery(facts({ tags: [], degree: 3 }), query)).toBe(false);
	});
});

describe('evaluateQuery', () => {
	it('returns only the matching node ids', () => {
		const factsByNode = new Map([
			['a', facts({ label: 'Alpha' })],
			['b', facts({ label: 'Beta' })],
		]);
		const result = evaluateQuery(factsByNode, { ...EMPTY_FILTER_QUERY, text: 'alp' });

		expect(result.has('a')).toBe(true);
		expect(result.has('b')).toBe(false);
	});
});
