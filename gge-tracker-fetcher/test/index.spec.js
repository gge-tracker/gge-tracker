import { describe, it, expect } from 'vitest';
import worker, { isAllowedTarget } from '../src';

const call = (query, method = 'GET') => worker.fetch(new Request(`https://cdn.gge-tracker.com/${query}`, { method }), {}, {});

describe('target allowlist', () => {
	it('accepts the game CDN', () => {
		expect(isAllowedTarget('https://empire-html5.goodgamestudios.com/default/assets/itemassets/a--1.png')).toBe(true);
	});

	it.each([
		'https://example.com/',
		'http://empire-html5.goodgamestudios.com/default/x.js',
		'https://empire-html5.goodgamestudios.com/config/x.json',
		'https://empire-html5.goodgamestudios.com.evil.com/default/x.js',
		'https://empire-html5.goodgamestudios.com@evil.com/default/x.js',
		'https://empire-html5.goodgamestudios.com/default/../../evil',
		'https://empire-html5.goodgamestudios.com/defaultx/x.js',
	])('refuses %s', (target) => {
		expect(isAllowedTarget(target)).toBe(false);
	});
});

describe('requests', () => {
	it('refuses another site without fetching it', async () => {
		const response = await call('?url=' + encodeURIComponent('https://example.com/'));
		expect(response.status).toBe(403);
	});

	it('refuses a missing url', async () => {
		expect((await call('')).status).toBe(400);
	});

	it('refuses anything but GET', async () => {
		const response = await call('?url=' + encodeURIComponent('https://empire-html5.goodgamestudios.com/default/a.js'), 'POST');
		expect(response.status).toBe(405);
	});
});
