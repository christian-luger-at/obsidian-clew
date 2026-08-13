import { describe, expect, it } from 'vitest';
import { parseEmbedConfig } from './embedConfig';

describe('parseEmbedConfig', () => {
	it('parses node and hops', () => {
		expect(parseEmbedConfig('node: World War II Era\nhops: 2')).toEqual({ node: 'World War II Era', hops: 2 });
	});

	it('defaults hops to 1 when omitted', () => {
		expect(parseEmbedConfig('node: Some Note')).toEqual({ node: 'Some Note', hops: 1 });
	});

	it('returns node: null when missing', () => {
		expect(parseEmbedConfig('hops: 2')).toEqual({ node: null, hops: 2 });
	});

	it('clamps hops above the 1-3 range', () => {
		expect(parseEmbedConfig('node: X\nhops: 12')).toEqual({ node: 'X', hops: 3 });
	});

	it('clamps hops below the 1-3 range', () => {
		expect(parseEmbedConfig('node: X\nhops: 0')).toEqual({ node: 'X', hops: 1 });
	});

	it('ignores a non-numeric hops value', () => {
		expect(parseEmbedConfig('node: X\nhops: many')).toEqual({ node: 'X', hops: 1 });
	});

	it('ignores blank lines and unknown keys', () => {
		expect(parseEmbedConfig('\nnode: X\n\ncolor: red\nhops: 2\n')).toEqual({ node: 'X', hops: 2 });
	});

	it('trims whitespace around key and value', () => {
		expect(parseEmbedConfig('  node :   My Note  \n hops : 3 ')).toEqual({ node: 'My Note', hops: 3 });
	});

	it('is case-insensitive on keys', () => {
		expect(parseEmbedConfig('Node: X\nHOPS: 2')).toEqual({ node: 'X', hops: 2 });
	});

	it('handles a node name containing a colon', () => {
		expect(parseEmbedConfig('node: Chapter 3: The Return')).toEqual({ node: 'Chapter 3: The Return', hops: 1 });
	});

	it('returns node: null and default hops for an empty source', () => {
		expect(parseEmbedConfig('')).toEqual({ node: null, hops: 1 });
	});

	it('treats an empty node value as missing', () => {
		expect(parseEmbedConfig('node: \nhops: 2')).toEqual({ node: null, hops: 2 });
	});
});
