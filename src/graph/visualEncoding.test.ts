import { describe, it, expect } from 'vitest';
import { colorByCategory, sizeByNumericValue } from './visualEncoding';

describe('colorByCategory', () => {
	it('gives the same color to nodes sharing a value', () => {
		const result = colorByCategory(
			new Map([
				['a', 'todo'],
				['b', 'todo'],
				['c', 'done'],
			]),
		);

		expect(result.get('a')).toBe(result.get('b'));
		expect(result.get('a')).not.toBe(result.get('c'));
	});

	it('is deterministic regardless of insertion order', () => {
		const first = colorByCategory(
			new Map([
				['a', 'zebra'],
				['b', 'apple'],
			]),
		);
		const second = colorByCategory(
			new Map([
				['b', 'apple'],
				['a', 'zebra'],
			]),
		);

		expect(first.get('a')).toBe(second.get('a'));
		expect(first.get('b')).toBe(second.get('b'));
	});

	it('omits nodes with an undefined value from the result', () => {
		const result = colorByCategory(
			new Map([
				['a', 'todo'],
				['b', undefined],
			]),
		);

		expect(result.has('a')).toBe(true);
		expect(result.has('b')).toBe(false);
	});

	it('cycles the palette when there are more distinct values than palette colors', () => {
		const entries = new Map<string, string | undefined>();
		for (let i = 0; i < 25; i++) entries.set(`node-${i}`, `value-${i}`);

		const result = colorByCategory(entries);

		expect(result.size).toBe(25);
		// Every value returned is a real color, not undefined/empty.
		for (const color of result.values()) {
			expect(color).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it('returns an empty map when nothing has a value', () => {
		const result = colorByCategory(new Map([['a', undefined]]));

		expect(result.size).toBe(0);
	});
});

describe('sizeByNumericValue', () => {
	it('maps the smallest value to the minimum size and the largest to the maximum', () => {
		const result = sizeByNumericValue(
			new Map([
				['a', 1],
				['b', 100],
			]),
		);

		expect(result.get('a')).toBeLessThan(result.get('b')!);
	});

	it('omits nodes with a non-numeric or missing value', () => {
		const result = sizeByNumericValue(
			new Map([
				['a', 5],
				['b', undefined],
			]),
		);

		expect(result.has('a')).toBe(true);
		expect(result.has('b')).toBe(false);
	});

	it('handles every node sharing the same value without dividing by zero', () => {
		const result = sizeByNumericValue(
			new Map([
				['a', 7],
				['b', 7],
			]),
		);

		expect(Number.isFinite(result.get('a'))).toBe(true);
		expect(result.get('a')).toBe(result.get('b'));
	});

	it('returns an empty map when no node has a numeric value', () => {
		const result = sizeByNumericValue(new Map([['a', undefined]]));

		expect(result.size).toBe(0);
	});

	it('produces sizes within the expected range', () => {
		const result = sizeByNumericValue(
			new Map([
				['a', 1],
				['b', 50],
				['c', 100],
			]),
		);

		for (const size of result.values()) {
			expect(size).toBeGreaterThanOrEqual(3);
			expect(size).toBeLessThanOrEqual(20);
		}
	});
});
