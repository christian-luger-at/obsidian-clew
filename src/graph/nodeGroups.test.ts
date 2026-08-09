import { describe, it, expect } from 'vitest';
import {
	describeCriterion,
	evaluateGroups,
	matchesGroup,
	needsClusterFreshness,
	needsContentSearch,
	needsStructuralDeviation,
	NodeGroup,
	NodeGroupFacts,
} from './nodeGroups';

function facts(overrides: Partial<NodeGroupFacts> = {}): NodeGroupFacts {
	return {
		label: 'Note',
		folder: '',
		content: '',
		tags: [],
		frontmatter: {},
		clusterStaleness: null,
		structuralDeviation: null,
		mtime: 0,
		degree: 0,
		exists: true,
		...overrides,
	};
}

function group(overrides: Partial<NodeGroup> = {}): NodeGroup {
	return {
		id: 'g1',
		name: 'Group',
		color: '#ff0000',
		sizeMultiplier: null,
		enabled: true,
		criteria: [],
		...overrides,
	};
}

describe('matchesGroup', () => {
	it('matches nothing when a group has no criteria', () => {
		expect(matchesGroup(facts({ label: 'Anything' }), group({ criteria: [] }))).toBe(false);
	});

	it('matches a tag criterion against any of several tags', () => {
		const g = group({ criteria: [{ type: 'tag', tags: ['#project', '#todo'] }] });
		expect(matchesGroup(facts({ tags: ['#project'] }), g)).toBe(true);
		expect(matchesGroup(facts({ tags: ['#todo'] }), g)).toBe(true);
		expect(matchesGroup(facts({ tags: ['#other'] }), g)).toBe(false);
	});

	it('matches a filename criterion case-insensitively', () => {
		const g = group({ criteria: [{ type: 'filename', query: 'topic' }] });
		expect(matchesGroup(facts({ label: 'Topic A' }), g)).toBe(true);
		expect(matchesGroup(facts({ label: 'Other' }), g)).toBe(false);
	});

	it('matches a folder criterion by prefix, not by substring, including subfolders', () => {
		const g = group({ criteria: [{ type: 'folder', folder: 'Work' }] });
		expect(matchesGroup(facts({ folder: 'Work' }), g)).toBe(true);
		expect(matchesGroup(facts({ folder: 'Work/Projects' }), g)).toBe(true);
		expect(matchesGroup(facts({ folder: 'Workshop' }), g)).toBe(false);
	});

	it('matches a text criterion against content, not just the title', () => {
		const g = group({ criteria: [{ type: 'text', query: 'roadmap' }] });
		expect(matchesGroup(facts({ label: 'Note', content: 'note\nsee the roadmap for details' }), g)).toBe(true);
		expect(matchesGroup(facts({ label: 'Note', content: 'note\nnothing relevant' }), g)).toBe(false);
	});

	describe('property criterion operators', () => {
		it('contains', () => {
			const g = group({ criteria: [{ type: 'property', key: 'status', operator: 'contains', value: 'do' }] });
			expect(matchesGroup(facts({ frontmatter: { status: 'done' } }), g)).toBe(true);
			expect(matchesGroup(facts({ frontmatter: { status: 'open' } }), g)).toBe(false);
		});

		it('equals', () => {
			const g = group({ criteria: [{ type: 'property', key: 'status', operator: 'equals', value: 'done' }] });
			expect(matchesGroup(facts({ frontmatter: { status: 'done' } }), g)).toBe(true);
			expect(matchesGroup(facts({ frontmatter: { status: 'done-ish' } }), g)).toBe(false);
		});

		it('notEquals', () => {
			const g = group({ criteria: [{ type: 'property', key: 'status', operator: 'notEquals', value: 'done' }] });
			expect(matchesGroup(facts({ frontmatter: { status: 'open' } }), g)).toBe(true);
			expect(matchesGroup(facts({ frontmatter: { status: 'done' } }), g)).toBe(false);
		});

		it('isEmpty', () => {
			const g = group({ criteria: [{ type: 'property', key: 'status', operator: 'isEmpty', value: '' }] });
			expect(matchesGroup(facts({ frontmatter: {} }), g)).toBe(true);
			expect(matchesGroup(facts({ frontmatter: { status: 'done' } }), g)).toBe(false);
		});

		it('isNotEmpty', () => {
			const g = group({ criteria: [{ type: 'property', key: 'status', operator: 'isNotEmpty', value: '' }] });
			expect(matchesGroup(facts({ frontmatter: { status: 'done' } }), g)).toBe(true);
			expect(matchesGroup(facts({ frontmatter: {} }), g)).toBe(false);
		});

		it('ignores a contains/equals/notEquals criterion with an empty value (never matches)', () => {
			const g = group({ criteria: [{ type: 'property', key: 'status', operator: 'contains', value: '' }] });
			expect(matchesGroup(facts({ frontmatter: { status: 'done' } }), g)).toBe(false);
		});
	});

	describe('clusterFreshness criterion', () => {
		it('stagnant bucket matches the stalest half (staleness >= 0.5)', () => {
			const g = group({ criteria: [{ type: 'clusterFreshness', bucket: 'stagnant' }] });
			expect(matchesGroup(facts({ clusterStaleness: 0.8 }), g)).toBe(true);
			expect(matchesGroup(facts({ clusterStaleness: 0.5 }), g)).toBe(true);
			expect(matchesGroup(facts({ clusterStaleness: 0.4 }), g)).toBe(false);
			expect(matchesGroup(facts({ clusterStaleness: null }), g)).toBe(false);
		});

		it('fresh bucket matches the freshest half (staleness < 0.5)', () => {
			const g = group({ criteria: [{ type: 'clusterFreshness', bucket: 'fresh' }] });
			expect(matchesGroup(facts({ clusterStaleness: 0.2 }), g)).toBe(true);
			expect(matchesGroup(facts({ clusterStaleness: 0.5 }), g)).toBe(false);
			expect(matchesGroup(facts({ clusterStaleness: null }), g)).toBe(false);
		});
	});

	describe('structuralDeviation criterion', () => {
		it('scattered bucket matches communities under half-homogeneous (deviation >= 0.5)', () => {
			const g = group({ criteria: [{ type: 'structuralDeviation', bucket: 'scattered' }] });
			expect(matchesGroup(facts({ structuralDeviation: 0.8 }), g)).toBe(true);
			expect(matchesGroup(facts({ structuralDeviation: 0.5 }), g)).toBe(true);
			expect(matchesGroup(facts({ structuralDeviation: 0.4 }), g)).toBe(false);
			expect(matchesGroup(facts({ structuralDeviation: null }), g)).toBe(false);
		});

		it('cohesive bucket matches communities at least half-homogeneous (deviation < 0.5)', () => {
			const g = group({ criteria: [{ type: 'structuralDeviation', bucket: 'cohesive' }] });
			expect(matchesGroup(facts({ structuralDeviation: 0.2 }), g)).toBe(true);
			expect(matchesGroup(facts({ structuralDeviation: 0.5 }), g)).toBe(false);
			expect(matchesGroup(facts({ structuralDeviation: null }), g)).toBe(false);
		});
	});

	describe('staleDays criterion', () => {
		it('matches notes not edited within the last N days', () => {
			const g = group({ criteria: [{ type: 'staleDays', days: 30 }] });
			const now = Date.now();
			expect(matchesGroup(facts({ mtime: now - 40 * 24 * 60 * 60 * 1000 }), g)).toBe(true);
			expect(matchesGroup(facts({ mtime: now - 10 * 24 * 60 * 60 * 1000 }), g)).toBe(false);
		});
	});

	describe('minLinks criterion', () => {
		it('matches notes with at least the given link count', () => {
			const g = group({ criteria: [{ type: 'minLinks', count: 3 }] });
			expect(matchesGroup(facts({ degree: 3 }), g)).toBe(true);
			expect(matchesGroup(facts({ degree: 5 }), g)).toBe(true);
			expect(matchesGroup(facts({ degree: 2 }), g)).toBe(false);
		});
	});

	describe('existence criterion', () => {
		it('matches only real notes when exists is true', () => {
			const g = group({ criteria: [{ type: 'existence', exists: true }] });
			expect(matchesGroup(facts({ exists: true }), g)).toBe(true);
			expect(matchesGroup(facts({ exists: false }), g)).toBe(false);
		});

		it('matches only ghost nodes when exists is false', () => {
			const g = group({ criteria: [{ type: 'existence', exists: false }] });
			expect(matchesGroup(facts({ exists: false }), g)).toBe(true);
			expect(matchesGroup(facts({ exists: true }), g)).toBe(false);
		});

		it('never lets a ghost node match a non-existence criterion, even when its default facts would coincidentally satisfy it', () => {
			// A ghost node's mtime defaults to 0 ("infinitely stale") and its
			// degree is its real edge count - both could otherwise
			// accidentally satisfy staleDays/minLinks criteria never meant to
			// consider it at all.
			const staleGroup = group({ criteria: [{ type: 'staleDays', days: 1 }] });
			expect(matchesGroup(facts({ exists: false, mtime: 0 }), staleGroup)).toBe(false);

			const linksGroup = group({ criteria: [{ type: 'minLinks', count: 1 }] });
			expect(matchesGroup(facts({ exists: false, degree: 5 }), linksGroup)).toBe(false);
		});
	});

	describe('negate', () => {
		it('inverts a folder criterion (exclude instead of include)', () => {
			const g = group({ criteria: [{ type: 'folder', folder: 'Archive', negate: true }] });
			expect(matchesGroup(facts({ folder: 'Archive' }), g)).toBe(false);
			expect(matchesGroup(facts({ folder: 'Archive/2024' }), g)).toBe(false);
			expect(matchesGroup(facts({ folder: 'Inbox' }), g)).toBe(true);
		});

		it('inverts a tag criterion', () => {
			const g = group({ criteria: [{ type: 'tag', tags: ['#archived'], negate: true }] });
			expect(matchesGroup(facts({ tags: ['#archived'] }), g)).toBe(false);
			expect(matchesGroup(facts({ tags: ['#active'] }), g)).toBe(true);
		});

		it('treats a missing negate field as false (not negated) - saved before this feature existed', () => {
			const g = group({ criteria: [{ type: 'folder', folder: 'Archive' }] });
			expect(matchesGroup(facts({ folder: 'Archive' }), g)).toBe(true);
		});

		it('a negated but still-unconfigured criterion matches nothing, not everything', () => {
			expect(matchesGroup(facts({ folder: 'Anything' }), group({ criteria: [{ type: 'folder', folder: '', negate: true }] }))).toBe(false);
			expect(matchesGroup(facts({ label: 'Anything' }), group({ criteria: [{ type: 'filename', query: '', negate: true }] }))).toBe(false);
			expect(matchesGroup(facts({ content: 'anything' }), group({ criteria: [{ type: 'text', query: '', negate: true }] }))).toBe(false);
			expect(matchesGroup(facts({ tags: ['#anything'] }), group({ criteria: [{ type: 'tag', tags: [], negate: true }] }))).toBe(false);
		});
	});

	it('ANDs across every criterion', () => {
		const g = group({
			criteria: [
				{ type: 'tag', tags: ['#project'] },
				{ type: 'folder', folder: 'Work' },
			],
		});
		expect(matchesGroup(facts({ tags: ['#project'], folder: 'Work' }), g)).toBe(true);
		expect(matchesGroup(facts({ tags: ['#project'], folder: 'Personal' }), g)).toBe(false);
		expect(matchesGroup(facts({ tags: [], folder: 'Work' }), g)).toBe(false);
	});
});

describe('evaluateGroups', () => {
	it('gives precedence to the first matching enabled group in array order', () => {
		const groupA = group({ id: 'a', criteria: [{ type: 'tag', tags: ['#note'] }] });
		const groupB = group({ id: 'b', criteria: [{ type: 'tag', tags: ['#note'] }] });
		const factsByNode = new Map([['n1', facts({ tags: ['#note'] })]]);

		expect(evaluateGroups(factsByNode, [groupA, groupB]).get('n1')?.id).toBe('a');
		expect(evaluateGroups(factsByNode, [groupB, groupA]).get('n1')?.id).toBe('b');
	});

	it('skips disabled groups', () => {
		const disabled = group({ id: 'a', enabled: false, criteria: [{ type: 'tag', tags: ['#note'] }] });
		const enabled = group({ id: 'b', enabled: true, criteria: [{ type: 'tag', tags: ['#note'] }] });
		const factsByNode = new Map([['n1', facts({ tags: ['#note'] })]]);

		expect(evaluateGroups(factsByNode, [disabled, enabled]).get('n1')?.id).toBe('b');
	});

	it('omits nodes matching no enabled group', () => {
		const g = group({ criteria: [{ type: 'tag', tags: ['#note'] }] });
		const factsByNode = new Map([['n1', facts({ tags: [] })]]);

		expect(evaluateGroups(factsByNode, [g]).has('n1')).toBe(false);
	});
});

describe('needsContentSearch', () => {
	it('is true only when an enabled group has a text criterion', () => {
		expect(needsContentSearch([group({ criteria: [{ type: 'text', query: 'x' }] })])).toBe(true);
		expect(needsContentSearch([group({ enabled: false, criteria: [{ type: 'text', query: 'x' }] })])).toBe(false);
		expect(needsContentSearch([group({ criteria: [{ type: 'tag', tags: ['#x'] }] })])).toBe(false);
	});
});

describe('needsClusterFreshness', () => {
	it('is true only when an enabled group has a clusterFreshness criterion', () => {
		expect(needsClusterFreshness([group({ criteria: [{ type: 'clusterFreshness', bucket: 'stagnant' }] })])).toBe(true);
		expect(needsClusterFreshness([group({ enabled: false, criteria: [{ type: 'clusterFreshness', bucket: 'stagnant' }] })])).toBe(false);
		expect(needsClusterFreshness([group({ criteria: [{ type: 'tag', tags: ['#x'] }] })])).toBe(false);
	});
});

describe('needsStructuralDeviation', () => {
	it('is true only when an enabled group has a structuralDeviation criterion', () => {
		expect(needsStructuralDeviation([group({ criteria: [{ type: 'structuralDeviation', bucket: 'scattered' }] })])).toBe(true);
		expect(
			needsStructuralDeviation([group({ enabled: false, criteria: [{ type: 'structuralDeviation', bucket: 'scattered' }] })]),
		).toBe(false);
		expect(needsStructuralDeviation([group({ criteria: [{ type: 'clusterFreshness', bucket: 'stagnant' }] })])).toBe(false);
	});
});

describe('describeCriterion', () => {
	it('describes a tag criterion as its tags, comma-joined', () => {
		expect(describeCriterion({ type: 'tag', tags: ['#project', '#urgent'] })).toBe('Has any of #project, #urgent');
	});

	it('describes an unconfigured tag criterion', () => {
		expect(describeCriterion({ type: 'tag', tags: [] })).toBe('Tag: (none picked)');
	});

	it('describes a property criterion as a mini-sentence', () => {
		expect(describeCriterion({ type: 'property', key: 'status', operator: 'contains', value: 'done' })).toBe('status contains "done"');
		expect(describeCriterion({ type: 'property', key: 'status', operator: 'equals', value: 'done' })).toBe('status equals "done"');
	});

	it('omits the value for isEmpty/isNotEmpty operators', () => {
		expect(describeCriterion({ type: 'property', key: 'status', operator: 'isEmpty', value: '' })).toBe('status is empty');
		expect(describeCriterion({ type: 'property', key: 'status', operator: 'isNotEmpty', value: '' })).toBe('status is not empty');
	});

	it('describes an unconfigured property criterion', () => {
		expect(describeCriterion({ type: 'property', key: '', operator: 'contains', value: '' })).toBe('Property: (none picked)');
	});

	it('describes folder/filename/text criteria with their type name, since they would otherwise all look like plain text', () => {
		expect(describeCriterion({ type: 'folder', folder: 'Archive' })).toBe('Folder is Archive');
		expect(describeCriterion({ type: 'filename', query: 'draft' })).toBe('Filename contains "draft"');
		expect(describeCriterion({ type: 'text', query: 'roadmap' })).toBe('Text contains "roadmap"');
	});

	it('describes a clusterFreshness criterion by its bucket', () => {
		expect(describeCriterion({ type: 'clusterFreshness', bucket: 'stagnant' })).toBe('Activity: inactive area of the vault');
		expect(describeCriterion({ type: 'clusterFreshness', bucket: 'fresh' })).toBe('Activity: active area of the vault');
	});

	it('describes a structuralDeviation criterion by its bucket', () => {
		expect(describeCriterion({ type: 'structuralDeviation', bucket: 'scattered' })).toBe('Structure: linked notes scattered across folders');
		expect(describeCriterion({ type: 'structuralDeviation', bucket: 'cohesive' })).toBe('Structure: linked notes gathered in one folder');
	});

	it('describes staleDays/minLinks criteria', () => {
		expect(describeCriterion({ type: 'staleDays', days: 30 })).toBe('At least 30 days ago');
		expect(describeCriterion({ type: 'minLinks', count: 3 })).toBe('At least 3 links');
	});

	it('describes an existence criterion by its exists value', () => {
		expect(describeCriterion({ type: 'existence', exists: true })).toBe('Existing notes');
		expect(describeCriterion({ type: 'existence', exists: false })).toBe('Nonexistent notes');
	});

	it('flips each type’s own wording when negated, instead of a generic "Not " prefix', () => {
		expect(describeCriterion({ type: 'folder', folder: 'Archive', negate: true })).toBe('Folder is not Archive');
		expect(describeCriterion({ type: 'filename', query: 'draft', negate: true })).toBe('Filename does not contain "draft"');
		expect(describeCriterion({ type: 'text', query: 'roadmap', negate: true })).toBe('Text does not contain "roadmap"');
		expect(describeCriterion({ type: 'tag', tags: ['#project'], negate: true })).toBe('Has none of #project');
		expect(describeCriterion({ type: 'staleDays', days: 30, negate: true })).toBe('Less than 30 days ago');
		expect(describeCriterion({ type: 'minLinks', count: 3, negate: true })).toBe('Fewer than 3 links');
		expect(describeCriterion({ type: 'tag', tags: ['#project'], negate: false })).toBe('Has any of #project');
	});
});
