import { describe, it, expect } from 'vitest';
import { EMPTY_SEARCH_QUERY, evaluateQuery, isEmptyQuery, matchesQuery, NoteSearchFacts } from './search';

function facts(overrides: Partial<NoteSearchFacts> = {}): NoteSearchFacts {
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
		expect(isEmptyQuery(EMPTY_SEARCH_QUERY)).toBe(true);
	});

	it('is false once text is set', () => {
		expect(isEmptyQuery({ ...EMPTY_SEARCH_QUERY, text: 'foo' })).toBe(false);
	});

	it('is false once a tag is set', () => {
		expect(isEmptyQuery({ ...EMPTY_SEARCH_QUERY, tag: '#project' })).toBe(false);
	});

	it('stays true for a property key with no value typed yet', () => {
		expect(isEmptyQuery({ ...EMPTY_SEARCH_QUERY, propertyKey: 'status' })).toBe(true);
	});

	it('is false once both property key and value are set', () => {
		expect(isEmptyQuery({ ...EMPTY_SEARCH_QUERY, propertyKey: 'status', propertyValue: 'done' })).toBe(false);
	});

	it('is false once staleDays is set', () => {
		expect(isEmptyQuery({ ...EMPTY_SEARCH_QUERY, staleDays: 30 })).toBe(false);
	});

	it('is false once minDegree is set', () => {
		expect(isEmptyQuery({ ...EMPTY_SEARCH_QUERY, minDegree: 5 })).toBe(false);
	});
});

describe('matchesQuery', () => {
	it('matches everything against the empty query', () => {
		expect(matchesQuery(facts({ label: 'Anything' }), EMPTY_SEARCH_QUERY)).toBe(true);
	});

	it('matches text case-insensitively as a substring', () => {
		const query = { ...EMPTY_SEARCH_QUERY, text: 'proj' };
		expect(matchesQuery(facts({ label: 'My Project' }), query)).toBe(true);
		expect(matchesQuery(facts({ label: 'Unrelated' }), query)).toBe(false);
	});

	it('matches an exact tag', () => {
		const query = { ...EMPTY_SEARCH_QUERY, tag: '#project' };
		expect(matchesQuery(facts({ tags: ['#project', '#todo'] }), query)).toBe(true);
		expect(matchesQuery(facts({ tags: ['#todo'] }), query)).toBe(false);
	});

	it('matches a frontmatter property as a case-insensitive substring', () => {
		const query = { ...EMPTY_SEARCH_QUERY, propertyKey: 'status', propertyValue: 'do' };
		expect(matchesQuery(facts({ frontmatter: { status: 'Done' } }), query)).toBe(true);
		expect(matchesQuery(facts({ frontmatter: { status: 'Archived' } }), query)).toBe(false);
		expect(matchesQuery(facts({ frontmatter: {} }), query)).toBe(false);
	});

	it('excludes a note edited more recently than staleDays', () => {
		const query = { ...EMPTY_SEARCH_QUERY, staleDays: 30 };
		const stale = facts({ mtime: Date.now() - 60 * 24 * 60 * 60 * 1000 });
		const fresh = facts({ mtime: Date.now() - 1 * 24 * 60 * 60 * 1000 });
		expect(matchesQuery(stale, query)).toBe(true);
		expect(matchesQuery(fresh, query)).toBe(false);
	});

	it('excludes a note below minDegree', () => {
		const query = { ...EMPTY_SEARCH_QUERY, minDegree: 3 };
		expect(matchesQuery(facts({ degree: 5 }), query)).toBe(true);
		expect(matchesQuery(facts({ degree: 1 }), query)).toBe(false);
	});

	it('requires every active criterion to match (AND, not OR)', () => {
		const query = { ...EMPTY_SEARCH_QUERY, tag: '#project', minDegree: 2 };
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
		const result = evaluateQuery(factsByNode, { ...EMPTY_SEARCH_QUERY, text: 'alp' });

		expect(result.has('a')).toBe(true);
		expect(result.has('b')).toBe(false);
	});
});
