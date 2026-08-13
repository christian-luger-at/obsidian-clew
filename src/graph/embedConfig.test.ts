import { describe, expect, it } from 'vitest';
import { parseEmbedConfig } from './embedConfig';

const DEFAULTS = { width: null, height: null, showRefreshButton: false };

describe('parseEmbedConfig', () => {
	it('parses node and hops', () => {
		expect(parseEmbedConfig('node: World War II Era\nhops: 2')).toEqual({ node: 'World War II Era', hops: 2, ...DEFAULTS });
	});

	it('defaults hops to 1 when omitted', () => {
		expect(parseEmbedConfig('node: Some Note')).toEqual({ node: 'Some Note', hops: 1, ...DEFAULTS });
	});

	it('returns node: null when missing', () => {
		expect(parseEmbedConfig('hops: 2')).toEqual({ node: null, hops: 2, ...DEFAULTS });
	});

	it('clamps hops above the 1-3 range', () => {
		expect(parseEmbedConfig('node: X\nhops: 12')).toEqual({ node: 'X', hops: 3, ...DEFAULTS });
	});

	it('clamps hops below the 1-3 range', () => {
		expect(parseEmbedConfig('node: X\nhops: 0')).toEqual({ node: 'X', hops: 1, ...DEFAULTS });
	});

	it('ignores a non-numeric hops value', () => {
		expect(parseEmbedConfig('node: X\nhops: many')).toEqual({ node: 'X', hops: 1, ...DEFAULTS });
	});

	it('ignores blank lines and unknown keys', () => {
		expect(parseEmbedConfig('\nnode: X\n\ncolor: red\nhops: 2\n')).toEqual({ node: 'X', hops: 2, ...DEFAULTS });
	});

	it('trims whitespace around key and value', () => {
		expect(parseEmbedConfig('  node :   My Note  \n hops : 3 ')).toEqual({ node: 'My Note', hops: 3, ...DEFAULTS });
	});

	it('is case-insensitive on keys', () => {
		expect(parseEmbedConfig('Node: X\nHOPS: 2')).toEqual({ node: 'X', hops: 2, ...DEFAULTS });
	});

	it('handles a node name containing a colon', () => {
		expect(parseEmbedConfig('node: Chapter 3: The Return')).toEqual({ node: 'Chapter 3: The Return', hops: 1, ...DEFAULTS });
	});

	it('returns node: null and default hops for an empty source', () => {
		expect(parseEmbedConfig('')).toEqual({ node: null, hops: 1, ...DEFAULTS });
	});

	it('treats an empty node value as missing', () => {
		expect(parseEmbedConfig('node: \nhops: 2')).toEqual({ node: null, hops: 2, ...DEFAULTS });
	});

	it('parses width and height as CSS lengths', () => {
		expect(parseEmbedConfig('node: X\nwidth: 600px\nheight: 40vh')).toMatchObject({ width: '600px', height: '40vh' });
	});

	it('accepts a percentage width', () => {
		expect(parseEmbedConfig('node: X\nwidth: 50%')).toMatchObject({ width: '50%' });
	});

	it('treats a bare number as px', () => {
		expect(parseEmbedConfig('node: X\nwidth: 600\nheight: 300')).toMatchObject({ width: '600px', height: '300px' });
	});

	it('ignores an unparseable width/height, leaving it null', () => {
		expect(parseEmbedConfig('node: X\nwidth: huge\nheight: also-huge')).toMatchObject({ width: null, height: null });
	});

	it('leaves width/height null when omitted', () => {
		expect(parseEmbedConfig('node: X')).toMatchObject({ width: null, height: null });
	});

	it.each(['true', 'yes', '1', 'on', 'TRUE', ' true '])('treats refresh: %s as enabling the button', (value) => {
		expect(parseEmbedConfig(`node: X\nrefresh: ${value}`)).toMatchObject({ showRefreshButton: true });
	});

	it.each(['false', 'no', '0', 'off', ''])('treats refresh: %s as not enabling the button', (value) => {
		expect(parseEmbedConfig(`node: X\nrefresh: ${value}`)).toMatchObject({ showRefreshButton: false });
	});

	it('defaults showRefreshButton to false when omitted', () => {
		expect(parseEmbedConfig('node: X')).toMatchObject({ showRefreshButton: false });
	});
});
