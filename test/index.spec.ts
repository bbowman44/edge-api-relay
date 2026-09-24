import { describe, it, expect } from 'vitest';
import { formatGold } from '../src/sources/wowToken';

describe('formatGold', () => {
	it('never exceeds the 6-character SHORT_TEXT budget', () => {
		const samples = [0, 42, 999, 1_000, 9_999, 98_400, 293_567, 999_499, 999_500, 999_999, 1_234_567, 9_999_999, 12_345_678];
		for (const gold of samples) {
			expect(`${gold} -> ${formatGold(gold)}`).toMatch(/-> .{1,6}$/);
		}
	});

	it('formats a realistic token price', () => {
		expect(formatGold(293_567)).toBe('293.6k');
	});

	it('rolls up to millions instead of overflowing to "1000.0k"', () => {
		expect(formatGold(999_499)).toBe('999.5k');
		expect(formatGold(999_500)).toBe('1.00m');
		expect(formatGold(999_999)).toBe('1.00m');
	});

	it('keeps two decimals when they fit', () => {
		expect(formatGold(98_400)).toBe('98.40k');
		expect(formatGold(1_234_567)).toBe('1.23m');
	});

	it('leaves sub-thousand values as plain integers', () => {
		expect(formatGold(842)).toBe('842');
	});

	it('honours a tighter budget', () => {
		expect(formatGold(293_567, 4).length).toBeLessThanOrEqual(4);
	});
});
