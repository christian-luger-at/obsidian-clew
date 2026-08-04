import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computeTimelineBounds, computeTimelineSteps, cursorForElapsed, cursorForElapsedByCalendar, stepIndexAtOrBefore, visibleEdgesAt, visibleNodesAt } from './timeline';

describe('computeTimelineBounds', () => {
	it('is null for an empty vault', () => {
		expect(computeTimelineBounds(new Map())).toBeNull();
	});

	it('spans the earliest to the latest ctime', () => {
		const bounds = computeTimelineBounds(
			new Map([
				['a', 100],
				['b', 300],
				['c', 200],
			]),
		);
		expect(bounds).toEqual({ start: 100, end: 300 });
	});

	it('collapses to a single instant for one note', () => {
		expect(computeTimelineBounds(new Map([['a', 100]]))).toEqual({ start: 100, end: 100 });
	});
});

describe('visibleNodesAt', () => {
	const ctimeByNode = new Map([
		['a', 100],
		['b', 200],
		['c', 300],
	]);

	it('shows only notes created on or before the cursor', () => {
		expect(visibleNodesAt(ctimeByNode, 200)).toEqual(new Set(['a', 'b']));
	});

	it('shows nothing before the earliest note', () => {
		expect(visibleNodesAt(ctimeByNode, 50)).toEqual(new Set());
	});

	it('shows everything at or after the latest note', () => {
		expect(visibleNodesAt(ctimeByNode, 300)).toEqual(new Set(['a', 'b', 'c']));
	});
});

describe('visibleEdgesAt', () => {
	it('reveals an edge once its later endpoint has appeared', () => {
		const graph = new Graph({ type: 'undirected' });
		graph.addNode('a');
		graph.addNode('b');
		graph.addEdge('a', 'b');
		const ctimeByNode = new Map([
			['a', 100],
			['b', 300],
		]);

		expect(visibleEdgesAt(graph, ctimeByNode, 200).size).toBe(0);
		expect(visibleEdgesAt(graph, ctimeByNode, 300).size).toBe(1);
	});

	it('treats a node missing from ctimeByNode as not yet born', () => {
		const graph = new Graph({ type: 'undirected' });
		graph.addNode('a');
		graph.addNode('b');
		graph.addEdge('a', 'b');

		expect(visibleEdgesAt(graph, new Map([['a', 100]]), Date.now()).size).toBe(0);
	});
});

describe('computeTimelineSteps', () => {
	it('dedupes and sorts distinct ctimes', () => {
		const steps = computeTimelineSteps(
			new Map([
				['a', 300],
				['b', 100],
				['c', 300],
				['d', 200],
			]),
		);
		expect(steps).toEqual([100, 200, 300]);
	});

	it('is empty for no notes', () => {
		expect(computeTimelineSteps(new Map())).toEqual([]);
	});
});

describe('stepIndexAtOrBefore', () => {
	const steps = [100, 200, 300];

	it('is -1 before the first step', () => {
		expect(stepIndexAtOrBefore(steps, 50)).toBe(-1);
	});

	it('finds the last step at or before the cursor', () => {
		expect(stepIndexAtOrBefore(steps, 250)).toBe(1);
		expect(stepIndexAtOrBefore(steps, 300)).toBe(2);
	});

	it('is the last index once past every step', () => {
		expect(stepIndexAtOrBefore(steps, 999)).toBe(2);
	});
});

describe('cursorForElapsed', () => {
	// 4 steps sharing a fixed 20s total duration - 5s per step regardless of
	// how far apart the steps' own real timestamps are (the whole point,
	// see computeTimelineSteps()'s docstring: a vault where most notes
	// share one ctime and only a few are much older shouldn't spend nearly
	// all of playback crawling through the sparse tail).
	const steps = [0, 1000, 2000, 999_999_999];

	it('starts at the first step', () => {
		expect(cursorForElapsed(steps, 0, 20)).toBe(0);
		expect(cursorForElapsed(steps, 4.9, 20)).toBe(0);
	});

	it('advances one step per equal 5s slice of the 20s total duration, not per calendar distance', () => {
		expect(cursorForElapsed(steps, 5, 20)).toBe(1000);
		expect(cursorForElapsed(steps, 9.9, 20)).toBe(1000);
		expect(cursorForElapsed(steps, 10, 20)).toBe(2000);
		// The huge final gap (steps[3] is ~11.5 days after steps[2]) still
		// only gets its equal 1/4 share (the last 5s) of the 20s duration,
		// not a share proportional to that gap.
		expect(cursorForElapsed(steps, 15, 20)).toBe(999_999_999);
	});

	it('clamps to the last step once elapsed reaches the total duration', () => {
		expect(cursorForElapsed(steps, 20, 20)).toBe(999_999_999);
		expect(cursorForElapsed(steps, 1000, 20)).toBe(999_999_999);
	});

	it('is 0 for an empty step list', () => {
		expect(cursorForElapsed([], 5, 20)).toBe(0);
	});
});

describe('cursorForElapsedByCalendar', () => {
	const bounds = { start: 0, end: 20_000 };

	it('interpolates linearly across the real date span, unlike cursorForElapsed', () => {
		expect(cursorForElapsedByCalendar(bounds, 0, 20)).toBe(0);
		expect(cursorForElapsedByCalendar(bounds, 5, 20)).toBe(5000);
		expect(cursorForElapsedByCalendar(bounds, 10, 20)).toBe(10_000);
	});

	it('clamps to the end once elapsed reaches the total duration', () => {
		expect(cursorForElapsedByCalendar(bounds, 20, 20)).toBe(20_000);
		expect(cursorForElapsedByCalendar(bounds, 1000, 20)).toBe(20_000);
	});

	it('is the end for a zero/negative duration', () => {
		expect(cursorForElapsedByCalendar(bounds, 5, 0)).toBe(20_000);
	});
});
