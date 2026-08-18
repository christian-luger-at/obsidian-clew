import { describe, it, expect } from 'vitest';
import { createFadeTracker, updateFadeTracker, fadeMultiplier, hasPendingFades } from './visibilityFade';

describe('visibilityFade', () => {
	it('returns 1 for a visible id that has never flipped', () => {
		const tracker = createFadeTracker();
		expect(fadeMultiplier(tracker, 'A', true, 300, 1000)).toBe(1);
	});

	it('returns 0 for a hidden id that has never flipped', () => {
		const tracker = createFadeTracker();
		expect(fadeMultiplier(tracker, 'A', false, 300, 1000)).toBe(0);
	});

	it('records a flip and ramps up toward 1 for a newly-visible id', () => {
		const tracker = createFadeTracker();
		updateFadeTracker(tracker, ['A'], () => true, 1000);

		expect(fadeMultiplier(tracker, 'A', true, 300, 1000)).toBe(0);
		expect(fadeMultiplier(tracker, 'A', true, 300, 1150)).toBeCloseTo(0.5, 5);
		expect(fadeMultiplier(tracker, 'A', true, 300, 1300)).toBe(1);
		expect(fadeMultiplier(tracker, 'A', true, 300, 5000)).toBe(1); // long after - settled, not stuck mid-fade
	});

	it('records a flip and ramps down toward 0 for a newly-hidden id', () => {
		const tracker = createFadeTracker();
		// Starts visible (no flip recorded), then flips to hidden.
		updateFadeTracker(tracker, ['A'], () => true, 0);
		updateFadeTracker(tracker, ['A'], () => false, 1000);

		expect(fadeMultiplier(tracker, 'A', false, 300, 1000)).toBe(1);
		expect(fadeMultiplier(tracker, 'A', false, 300, 1150)).toBeCloseTo(0.5, 5);
		expect(fadeMultiplier(tracker, 'A', false, 300, 1300)).toBe(0);
	});

	it('does not re-flip on repeated update() calls with the same visibility', () => {
		const tracker = createFadeTracker();
		updateFadeTracker(tracker, ['A'], () => true, 1000);
		updateFadeTracker(tracker, ['A'], () => true, 1200); // same target, should be a no-op
		updateFadeTracker(tracker, ['A'], () => true, 1400);

		// Progress is still measured from the *original* flip at 1000, not
		// restarted by the later no-op calls.
		expect(fadeMultiplier(tracker, 'A', true, 300, 1300)).toBe(1);
	});

	it('tracks multiple ids independently - only the one that actually flips animates', () => {
		const tracker = createFadeTracker();
		// Both start visible (e.g. the "no filter enabled yet" baseline every
		// node is visible under, matching applyFilter()'s real call site).
		updateFadeTracker(tracker, ['A', 'B'], () => true, 0);
		// A filter is enabled: A still matches (stays visible, no flip), B no
		// longer does (flips to hidden).
		updateFadeTracker(tracker, ['A', 'B'], (id) => id === 'A', 1000);

		expect(fadeMultiplier(tracker, 'A', true, 300, 1000)).toBe(1); // never flipped, no animation
		expect(fadeMultiplier(tracker, 'B', false, 300, 1000)).toBe(1); // just flipped, starts its fade-out at full opacity
		expect(fadeMultiplier(tracker, 'B', false, 300, 1300)).toBe(0); // fade-out finished
	});

	it('hasPendingFades is true while any id is mid-transition', () => {
		const tracker = createFadeTracker();
		updateFadeTracker(tracker, ['A'], () => true, 1000);

		expect(hasPendingFades(tracker, 300, 1100)).toBe(true);
		expect(hasPendingFades(tracker, 300, 1400)).toBe(false);
	});

	it('hasPendingFades is false for a fresh tracker with nothing recorded yet', () => {
		const tracker = createFadeTracker();
		expect(hasPendingFades(tracker, 300, 1000)).toBe(false);
	});
});
