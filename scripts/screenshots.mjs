#!/usr/bin/env node
/**
 * Automated documentation screenshots + README tour GIF.
 *
 * Drives the real Obsidian app over the Chrome DevTools Protocol: it builds
 * a small, curated screenshot vault (the same demo content
 * gen-test-vault.mjs generates, plus a couple of pre-configured filters/
 * groups so those panels aren't shown empty), launches Obsidian against it
 * with remote debugging enabled, opens the Clew graph view, captures each
 * panel in light and dark themes, and records a short scripted tour as an
 * animated GIF - all into docs/public/screens/.
 *
 * Usage:
 *   node scripts/screenshots.mjs              # requires Obsidian to be closed
 *   node scripts/screenshots.mjs --quit       # quit a running Obsidian first
 *
 * Obsidian's own config (obsidian.json) is backed up and restored, so your
 * normal vault setup is left exactly as it was. macOS only (launches
 * /Applications/Obsidian.app directly).
 */
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const REPO = resolve(process.cwd());
const VAULT = join(REPO, '.screenshot-vault');
const OUT = join(REPO, 'docs/public/screens');
const PORT = 9222;
const OBSIDIAN = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const CONFIG = join(homedir(), 'Library/Application Support/obsidian/obsidian.json');
const BACKUP = `${CONFIG}.clew-backup`;
const QUIT = process.argv.includes('--quit');
const PLUGIN_ID = 'clew';
const VIEW_TYPE = 'clew-standalone-graph';
// The demo vault's best-connected note (see gen-test-vault.mjs) - a good
// subject for the "hover highlights connections" shot.
const HOVER_NODE_ID = 'Notes/Hub.md';

const log = (m) => console.log(`  ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. A small, curated vault: the same demo content as `npm run gen-test-vault`,
//    plus a couple of pre-configured filters/groups so the Filter and Color &
//    size panels have something real to show instead of an empty list.
// ---------------------------------------------------------------------------
function buildVault() {
	rmSync(VAULT, { recursive: true, force: true });
	mkdirSync(join(VAULT, `.obsidian/plugins/${PLUGIN_ID}`), { recursive: true });

	execFileSync('node', [join(REPO, 'scripts/gen-test-vault.mjs'), VAULT], { stdio: 'inherit' });

	// Copy (not symlink) the built plugin, so its data.json stays in the vault.
	for (const f of ['main.js', 'manifest.json', 'styles.css']) {
		copyFileSync(join(REPO, f), join(VAULT, `.obsidian/plugins/${PLUGIN_ID}`, f));
	}
	writeFileSync(join(VAULT, '.obsidian/community-plugins.json'), JSON.stringify([PLUGIN_ID]));

	// Pre-seed a couple of filters/groups that match the demo vault's own
	// "status" frontmatter (see gen-test-vault.mjs's Topic A/B/C notes) and
	// its backdated "Old Cluster"/"Medium Age" notes, so both panels show
	// realistic, already-filled-in state rather than "No filters yet."/
	// "No groups yet.".
	const data = {
		filterCombineMode: 'or',
		filterPresets: [
			{ id: 'f1', name: 'Recently edited', enabled: true, criteria: [{ type: 'staleDays', days: 30, negate: true }] },
			{ id: 'f2', name: 'Stale', enabled: false, criteria: [{ type: 'staleDays', days: 45 }] },
		],
		nodeGroups: [
			{
				id: 'g1',
				name: 'Active',
				color: '#22c55e',
				sizeMultiplier: null,
				enabled: true,
				criteria: [{ type: 'property', key: 'status', operator: 'equals', value: 'active' }],
			},
			{
				id: 'g2',
				name: 'Archived',
				color: '#64748b',
				sizeMultiplier: null,
				enabled: true,
				criteria: [{ type: 'property', key: 'status', operator: 'equals', value: 'archived' }],
			},
		],
	};
	writeFileSync(join(VAULT, `.obsidian/plugins/${PLUGIN_ID}/data.json`), JSON.stringify(data, null, 2));
	writeFileSync(join(VAULT, '.obsidian/app.json'), JSON.stringify({ promptDelete: false }));
	log(`vault ready: ${VAULT}`);
}

// ---------------------------------------------------------------------------
// 2. Point Obsidian at it (reversibly).
// ---------------------------------------------------------------------------
function patchObsidianConfig() {
	copyFileSync(CONFIG, BACKUP);
	const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
	cfg.vaults ??= {};
	for (const v of Object.values(cfg.vaults)) v.open = false;
	cfg.vaults[randomBytes(8).toString('hex')] = { path: VAULT, ts: Date.now(), open: true };
	writeFileSync(CONFIG, JSON.stringify(cfg));
	log('obsidian.json patched (backup kept)');
}
function restoreObsidianConfig() {
	if (existsSync(BACKUP)) {
		copyFileSync(BACKUP, CONFIG);
		rmSync(BACKUP);
		log('obsidian.json restored');
	}
}

// ---------------------------------------------------------------------------
// 3. Launch + connect.
// ---------------------------------------------------------------------------
async function waitForCdp(timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
			if (r.ok) return;
		} catch { /* not up yet */ }
		await sleep(400);
	}
	throw new Error(`Obsidian did not expose the debugging port ${PORT} in time.`);
}

async function obsidianPage(browser) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		for (const ctx of browser.contexts()) {
			for (const p of ctx.pages()) {
				if (p.url().startsWith('app://')) {
					const ready = await p.evaluate(() => !!globalThis.app?.workspace?.layoutReady).catch(() => false);
					if (ready) return p;
				}
			}
		}
		await sleep(500);
	}
	throw new Error('Could not find a ready Obsidian window.');
}

/**
 * A fresh vault starts in restricted mode and may show a "trust author"
 * dialog, so the community plugin never loads. Dismiss the dialog, leave
 * restricted mode, and enable the plugin through Obsidian's own API, then
 * wait for it.
 */
async function ensurePlugin(page) {
	await page.evaluate(async (id) => {
		// Best effort: accept the "trust author and enable plugins" dialog.
		const cta = document.querySelector('.modal .modal-button-container button.mod-cta');
		if (cta) cta.click();
		const P = globalThis.app.plugins;
		try { await P.setEnable?.(true); } catch { /* already enabled */ }
		try { await P.enablePluginAndSave?.(id); } catch { /* already enabled */ }
	}, PLUGIN_ID);

	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		const loaded = await page.evaluate((id) => !!globalThis.app.plugins.plugins[id], PLUGIN_ID);
		if (loaded) { log('plugin loaded'); return; }
		await sleep(500);
	}
	const state = await page.evaluate(() => {
		const P = globalThis.app.plugins;
		return JSON.stringify({
			enabled: [...(P.enabledPlugins ?? [])],
			modalText: document.querySelector('.modal')?.innerText?.slice(0, 200) ?? null,
		});
	});
	throw new Error(`${PLUGIN_ID} did not load. Obsidian state: ${state}`);
}

// ---------------------------------------------------------------------------
// 4. The motifs.
// ---------------------------------------------------------------------------
async function setTheme(page, theme) {
	await page.evaluate((t) => {
		document.body.classList.toggle('theme-dark', t === 'dark');
		document.body.classList.toggle('theme-light', t === 'light');
	}, theme);
	await sleep(250);
}

async function shoot(page, name, theme, selector) {
	const file = join(OUT, `${name}-${theme}.png`);
	// The Filter and Color & size panels share the CSS class
	// `clew-filter-panel` (both exist in the DOM at all times, only one is
	// ever shown) - `:visible` picks the one actually on screen instead of
	// `.first()`'s DOM-order match, which would silently grab the hidden one
	// and throw on screenshot(), aborting the whole run.
	await page.locator(`${selector}:visible`).first().screenshot({ path: file });
	log(`shot ${name}-${theme}.png`);
}

/** Escape any leftover dialog (trust prompt, restricted mode, the Layout picker) before/after shooting one. */
async function closeModals(page) {
	for (let i = 0; i < 6; i++) {
		const open = await page.evaluate(() => !!document.querySelector('.modal-container'));
		if (!open) return;
		await page.keyboard.press('Escape');
		await sleep(400);
	}
	log('warning: a dialog is still open');
}

/**
 * Safety net for a panel that failed to close normally (see closePanel()'s
 * docstring) - hides it the same way Obsidian's own .hide() would, directly
 * in-page rather than via a click, so one stuck panel can't keep blocking
 * every shot after it for the rest of the run.
 */
async function forceClosePanels(page) {
	await page.evaluate(() => {
		document.querySelectorAll('.clew-filter-panel, .clew-appearance-panel').forEach((el) => {
			el.style.display = 'none';
		});
	});
}

/** Opens the graph view wide in the main pane (it ships in a normal tab, but for documentation shots the sidebars should stay collapsed). */
async function openGraphWide(page) {
	await page.evaluate(async (viewType) => {
		const ws = globalThis.app.workspace;
		ws.leftSplit?.collapse?.();
		ws.rightSplit?.collapse?.();
		// Reuse an existing graph leaf instead of always opening a new tab -
		// otherwise a second call (e.g. recordTour() after capture()) leaves
		// two `.clew-graph-view` elements in the DOM, and a bare
		// waitForSelector below would wait on the wrong (background, hidden)
		// one - same DOM-order pitfall as the shared-class panels.
		const existing = ws.getLeavesOfType(viewType)[0];
		const leaf = existing ?? ws.getLeaf(false);
		await leaf.setViewState({ type: viewType, active: true });
		await ws.revealLeaf(leaf);
	}, VIEW_TYPE);
	await page.waitForSelector('.clew-graph-view:visible', { timeout: 15000 });
}

/** Clicks a toolbar icon by its (Obsidian setTooltip-set) aria-label - `^=` since the Layout button's own label includes the current mode ("Layout: Force"). */
async function clickToolbarIcon(page, label) {
	await page.locator(`.clew-toolbar button[aria-label^="${label}"]`).first().click();
}

/**
 * Closes a panel via its own header Close button, not by re-clicking the
 * toolbar toggle that opened it: at the stills' capture resolution, the
 * Appearance panel can extend up over the toolbar, so a second click on the
 * (now-obscured) toolbar button hits the panel instead and times out -
 * discovered when that exact failure cascaded into every shot after it.
 */
async function closePanel(page, panelSelector) {
	await page.locator(`${panelSelector} button[aria-label="Close"]`).first().click();
}

/**
 * The viewport (page-relative) pixel coordinates of a node, straight from
 * Sigma's own camera - reading the DOM instead would mean guessing which
 * canvas pixel a node's center actually lands on.
 */
async function nodeViewportCoords(page, nodeId) {
	return page.evaluate(
		({ viewType, id }) => {
			const leaf = globalThis.app.workspace.getLeavesOfType(viewType)[0];
			const renderer = leaf?.view?.pane?.renderer;
			const display = renderer?.getNodeDisplayData(id);
			if (!renderer || !display) return null;
			const viewport = renderer.graphToViewport({ x: display.x, y: display.y });
			const rect = renderer.getContainer().getBoundingClientRect();
			return { x: rect.left + viewport.x, y: rect.top + viewport.y };
		},
		{ viewType: VIEW_TYPE, id: nodeId },
	);
}

async function capture(page) {
	mkdirSync(OUT, { recursive: true });

	// A widescreen hero shot, not the tall/narrow framing a sidebar view
	// would use - the graph itself reads best wide.
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
	await sleep(500);

	await closeModals(page);
	await openGraphWide(page);
	// SETTLE_DURATION_MS (2s) plus margin, so Force layout has fully settled
	// (the camera now tracks it live while it does - see graphPane.ts's
	// setForceLayout()) before the first shot.
	await sleep(3000);

	// Each motif is independent documentation content - one failing (a
	// selector that stops matching, a dialog that doesn't open in time)
	// shouldn't take out every shot after it for both themes, so failures
	// are logged and skipped rather than thrown.
	const attempt = async (label, fn) => {
		try {
			await fn();
		} catch (err) {
			log(`warning: "${label}" failed, skipping - ${err.message}`);
			await closeModals(page);
			await forceClosePanels(page);
		}
	};

	for (const theme of ['light', 'dark']) {
		await setTheme(page, theme);
		await page.mouse.move(0, 0);
		await sleep(300);

		await attempt(`graph-overview-${theme}`, () => shoot(page, 'graph-overview', theme, '.clew-graph-view'));

		await attempt(`layout-picker-${theme}`, async () => {
			await clickToolbarIcon(page, 'Layout');
			await page.waitForSelector('.clew-layout-option-list', { timeout: 5000 });
			await sleep(300);
			await shoot(page, 'layout-picker', theme, '.modal-container');
			await closeModals(page);
		});

		await attempt(`filter-panel-${theme}`, async () => {
			await clickToolbarIcon(page, 'Filter');
			// `:visible` - with 2 DOM matches (Filter and Color & size share
			// this class), a bare waitForSelector waits on the *first* DOM
			// match specifically, not "any match" - which can be the other,
			// permanently-hidden panel, timing out even once this one opens.
			await page.waitForSelector('.clew-filter-panel:visible', { timeout: 5000 });
			await sleep(300);
			await shoot(page, 'filter-panel', theme, '.clew-filter-panel');
			await closePanel(page, '.clew-filter-panel:visible');
			await sleep(200);
		});

		await attempt(`color-and-size-panel-${theme}`, async () => {
			await clickToolbarIcon(page, 'Color & size');
			await page.waitForSelector('.clew-filter-panel:visible', { timeout: 5000 });
			await sleep(300);
			await shoot(page, 'color-and-size-panel', theme, '.clew-filter-panel');
			await closePanel(page, '.clew-filter-panel:visible');
			await sleep(200);
		});

		await attempt(`appearance-panel-${theme}`, async () => {
			await clickToolbarIcon(page, 'Appearance');
			await page.waitForSelector('.clew-appearance-panel', { timeout: 5000 });
			await sleep(300);
			await shoot(page, 'appearance-panel', theme, '.clew-appearance-panel');
			await closePanel(page, '.clew-appearance-panel');
			await sleep(200);
		});

		await attempt(`node-hover-${theme}`, async () => {
			const hoverPoint = await nodeViewportCoords(page, HOVER_NODE_ID);
			if (!hoverPoint) {
				log(`warning: could not locate node "${HOVER_NODE_ID}" for the hover shot - skipped`);
				return;
			}
			await page.mouse.move(hoverPoint.x, hoverPoint.y);
			await page.mouse.move(hoverPoint.x + 1, hoverPoint.y + 1); // a real second event, some hover handlers need movement, not just a teleport
			await sleep(700);
			await shoot(page, 'node-hover', theme, '.clew-graph-view');
			await page.mouse.move(0, 0);
			await sleep(300);
		});
	}
}

/**
 * Records a short scripted tour as an animated GIF for the README's hero
 * image: hover a hub node, switch layouts, then narrow the graph with a
 * filter. Frames come from the CDP screencast (which only emits on visual
 * change), so each frame's real duration is preserved via ffmpeg's concat
 * demuxer and dead time is compressed automatically - same technique as the
 * focus-first plugin's own tour recorder.
 */
async function recordTour(page) {
	const dir = join(VAULT, '.frames');
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });

	await closeModals(page);
	await openGraphWide(page);
	await setTheme(page, 'light'); // fixed theme - a GIF can't switch with the reader's OS the way the light/dark PNG pairs do
	await sleep(3000); // let Force settle before recording starts

	const cdp = await page.context().newCDPSession(page);
	// Its own landscape canvas, wider than the documentation stills, so the
	// GIF reads well as a README hero rather than a tall crop.
	await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
	await sleep(500);

	const frames = [];
	cdp.on('Page.screencastFrame', async (f) => {
		frames.push({ buf: Buffer.from(f.data, 'base64'), ts: Date.now() });
		try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* stopped */ }
	});
	await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
	await sleep(1000);

	// 1. Hover the hub node to reveal its highlighted neighbors.
	const hoverPoint = await nodeViewportCoords(page, HOVER_NODE_ID);
	if (hoverPoint) {
		await page.mouse.move(hoverPoint.x, hoverPoint.y);
		await page.mouse.move(hoverPoint.x + 1, hoverPoint.y + 1);
		await sleep(1800);
		await page.mouse.move(0, 0);
		await sleep(700);
	}

	// 2. Switch to the Hierarchical layout and back to Force.
	const pickLayout = async (label) => {
		await clickToolbarIcon(page, 'Layout');
		await page.waitForSelector('.clew-layout-option-list', { timeout: 5000 });
		await sleep(200);
		await page.locator(`.clew-layout-option:has-text("${label}")`).first().click();
	};
	await pickLayout('Hierarchical');
	await sleep(2000);
	await pickLayout('Force');
	await sleep(2000);

	// 3. Open Filter, enable a filter to narrow the graph, then disable it again.
	await clickToolbarIcon(page, 'Filter');
	await page.waitForSelector('.clew-filter-panel:visible', { timeout: 5000 });
	await sleep(500);
	const toggle = page.locator('.clew-group-row:has-text("Stale") .checkbox-container').first();
	await toggle.click();
	await sleep(1800);
	await toggle.click();
	await sleep(600);
	await closePanel(page, '.clew-filter-panel:visible');
	await sleep(900);

	await cdp.send('Page.stopScreencast');
	if (frames.length < 2) throw new Error('the screencast produced no frames');

	const lines = [];
	frames.forEach((f, i) => {
		const name = `f${String(i).padStart(5, '0')}.jpg`;
		writeFileSync(join(dir, name), f.buf);
		const next = frames[i + 1];
		const dur = next ? Math.min((next.ts - f.ts) / 1000, 2) : 0.8;
		lines.push(`file '${name}'`, `duration ${Math.max(dur, 0.04).toFixed(3)}`);
	});
	lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
	writeFileSync(join(dir, 'list.txt'), lines.join('\n'));

	mkdirSync(OUT, { recursive: true });
	const gif = join(OUT, 'tour.gif');
	execFileSync('ffmpeg', [
		'-y', '-hide_banner', '-loglevel', 'error',
		'-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
		'-vf', 'fps=12,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
		'-loop', '0', gif,
	]);
	rmSync(dir, { recursive: true, force: true });
	const kb = Math.round(readFileSync(gif).length / 1024);
	log(`recorded tour.gif from ${frames.length} frames (${kb} KB)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let child;
try {
	if (!existsSync(OBSIDIAN)) throw new Error(`Obsidian not found at ${OBSIDIAN}`);
	for (const f of ['main.js', 'manifest.json', 'styles.css']) {
		if (!existsSync(join(REPO, f))) throw new Error(`${f} missing. Run "npm run build" first.`);
	}

	let running = false;
	try { execFileSync('pgrep', ['-x', 'Obsidian'], { stdio: 'ignore' }); running = true; } catch { /* not running */ }
	if (running) {
		if (!QUIT) {
			throw new Error(
				'Obsidian is running. Screenshots need it launched with a debugging port.\n' +
				'  Quit Obsidian and re-run, or pass --quit to close it automatically.',
			);
		}
		log('quitting the running Obsidian...');
		execFileSync('osascript', ['-e', 'quit app "Obsidian"']);
		await sleep(2500);
	}

	buildVault();
	patchObsidianConfig();

	log('launching Obsidian with remote debugging...');
	child = spawn(OBSIDIAN, [`--remote-debugging-port=${PORT}`], { detached: true, stdio: 'ignore' });
	await waitForCdp();

	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
	const page = await obsidianPage(browser);
	log('connected to the Obsidian window');

	await ensurePlugin(page);
	await capture(page);
	await recordTour(page);
	await browser.close();
	console.log(`\nScreenshots written to ${OUT}`);
} catch (err) {
	console.error(`\nScreenshot run failed: ${err.message}`);
	process.exitCode = 1;
} finally {
	try { execFileSync('osascript', ['-e', 'quit app "Obsidian"']); } catch { /* already gone */ }
	await sleep(1200);
	restoreObsidianConfig();
	child?.unref?.();
}
