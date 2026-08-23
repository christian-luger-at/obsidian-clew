import { App, PluginSettingTab, Setting, SettingDefinitionItem, setIcon, setTooltip, TFile, TFolder } from 'obsidian';
import type ClewPlugin from './main';
import { GraphPane } from './graph/graphPane';
import { NoteSuggest } from './graph/noteSuggest';
import { FolderSuggest } from './graph/folderSuggest';

/**
 * Clew's entry in Obsidian's own Settings screen (Settings → Community
 * plugins → Clew) - the plugin's first, so far. Every other tunable so far
 * (Appearance's sliders, Filter/Color & size, Timeline) lives inside the
 * graph view's own panels instead, since those are things you tune while
 * watching the graph react (see settings.ts's ClewAppearanceSettings
 * docstring). The Diagnostics section toggles here are different: a
 * one-time "what do I even want to see" choice, made once and forgotten,
 * which is what Obsidian's own Settings screen is for - not something that
 * needs the graph on screen to make sense of.
 *
 * Implements both `getSettingDefinitions()` (Obsidian 1.13+'s declarative
 * API - the toggles below become indexable by Obsidian's own settings
 * search) and `display()` (the pre-1.13 imperative fallback,
 * `getSettingDefinitions()`'s own docstring: "Only implement display() as
 * a fallback for plugins that need to support Obsidian versions older than
 * 1.13.0" - manifest.json's minAppVersion is 1.12.0, so this plugin still
 * needs it). Both call the exact same renderExcludedNotesSetting()/
 * renderExcludedFoldersSetting() helpers (now taking an already-named
 * `Setting` rather than a bare `containerEl`) so the two code paths can't
 * drift out of sync with each other - the custom note/folder picker+chips
 * UI has no equivalent declarative control type, so it's still rendered
 * imperatively either way (1.13+ via a `render` definition, pre-1.13 via
 * display() calling it directly).
 *
 * getSettingDefinitions() itself is unverified against a real Obsidian
 * 1.13+ build - the newest available in this dev environment is 1.12.7, a
 * version old enough that it never calls getSettingDefinitions() at all
 * (falls through to display() instead, which *is* exercised by the usual
 * manual-QA vault). Built against the official 1.13.1 type definitions,
 * not guessed.
 */
export class ClewSettingTab extends PluginSettingTab {
	private readonly plugin: ClewPlugin;

	constructor(app: App, plugin: ClewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Every toggle below is a plain `boolean` living at a fixed, known path
	 * in `ClewSettings` - simple enough that a hand-written switch is
	 * clearer and safer than a generic dotted-path resolver would be for
	 * just five keys, and it keeps this in one place next to
	 * getSettingDefinitions() itself rather than introducing a parsing
	 * convention that would need documenting on its own.
	 */
	getControlValue(key: string): unknown {
		switch (key) {
			case 'diagnostics.showOrphans':
				return this.plugin.settings.diagnostics.showOrphans;
			case 'diagnostics.showBrokenLinks':
				return this.plugin.settings.diagnostics.showBrokenLinks;
			case 'diagnostics.showIsolatedClusters':
				return this.plugin.settings.diagnostics.showIsolatedClusters;
			case 'diagnostics.showStructuralDeviation':
				return this.plugin.settings.diagnostics.showStructuralDeviation;
			case 'debugMode':
				return this.plugin.settings.debugMode;
			default:
				// Unreachable in practice - the only keys Obsidian ever asks
				// for here are the ones getSettingDefinitions() itself
				// handed out above, and that list matches this switch
				// exactly. A real hit means a getSettingDefinitions() edit
				// added a `control.key` without a matching case here - fail
				// loudly rather than falling through to
				// `super.getControlValue()` (itself a 1.13.0+-only API
				// `eslint-plugin-obsidianmd`'s no-unsupported-api rule
				// correctly flags as unsafe to call given this plugin's own
				// minAppVersion of 1.12.0, and not something this branch
				// could productively delegate to anyway - the base
				// implementation reads `app.vault.getConfig`, meaningless
				// for this plugin's own settings).
				throw new Error(`Clew: no setting registered for control key "${key}"`);
		}
	}

	/** Counterpart to getControlValue() above - same five keys, same reasoning for a hand-written switch over a generic resolver. Persists via plugin.saveSettings() (not a bare saveData() call), matching every other settings-mutation path in this file and GraphPane's own. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key) {
			case 'diagnostics.showOrphans':
				this.plugin.settings.diagnostics.showOrphans = value as boolean;
				break;
			case 'diagnostics.showBrokenLinks':
				this.plugin.settings.diagnostics.showBrokenLinks = value as boolean;
				break;
			case 'diagnostics.showIsolatedClusters':
				this.plugin.settings.diagnostics.showIsolatedClusters = value as boolean;
				break;
			case 'diagnostics.showStructuralDeviation':
				this.plugin.settings.diagnostics.showStructuralDeviation = value as boolean;
				break;
			case 'debugMode':
				this.plugin.settings.debugMode = value as boolean;
				break;
			default:
				// See getControlValue()'s own comment on its identical
				// default branch - same reasoning applies here.
				throw new Error(`Clew: no setting registered for control key "${key}"`);
		}
		await this.plugin.saveSettings();
	}

	/**
	 * The 1.13+ declarative shape - three headed groups mirroring display()
	 * below exactly (same names/descriptions/order), toggle controls backed
	 * by getControlValue()/setControlValue() above, and the two custom
	 * note/folder pickers as `render` definitions delegating to the same
	 * helpers display() itself calls.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				// SettingDefinitionGroup has no `desc` of its own (only
				// SettingDefinitionBase-derived items do) - the old intro
				// paragraph here ("Choose which sections...") is dropped
				// from this declarative view rather than shoehorned into an
				// empty-name row purely to hold it; each toggle's own desc
				// already explains itself, and display() below (still used
				// on Obsidian < minAppVersion 1.13.0) keeps the paragraph
				// exactly as before.
				type: 'group',
				heading: 'Diagnostics panel',
				items: [
					{
						name: 'Orphans',
						desc: 'Notes with no links in or out.',
						control: { type: 'toggle', key: 'diagnostics.showOrphans' },
					},
					{
						name: 'Broken links',
						desc: 'Links that don\'t resolve to a note. Turn this off if you deliberately link to notes that don\'t exist yet ("stub first, write later") and don\'t want them flagged.',
						control: { type: 'toggle', key: 'diagnostics.showBrokenLinks' },
					},
					{
						name: 'Isolated clusters',
						desc: "Groups of linked notes that aren't connected to the rest of the vault.",
						control: { type: 'toggle', key: 'diagnostics.showIsolatedClusters' },
					},
					{
						name: 'Structural deviation',
						desc: 'Groups of heavily-linked notes scattered across several different folders.',
						control: { type: 'toggle', key: 'diagnostics.showStructuralDeviation' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Find path',
				items: [
					{
						// Same "no group-level desc" gap as Diagnostics panel
						// above - the explanation moves onto this row's own
						// desc instead, since it's specifically about what
						// "excluded" means here (a `SettingDefinitionRender`
						// still extends SettingDefinitionBase, so it does
						// have `desc`, unlike the group wrapping it).
						name: 'Excluded notes',
						desc: 'Notes every Find-path search leaves out entirely (e.g. a big MOC/index note you never want a route hopping through) - excluded notes also get a ring while Find-path is open, so you can see which ones at a glance. Configured only here, not in the Find-path dialog itself.',
						render: (setting) => this.renderExcludedNotesSetting(setting),
					},
					{
						name: 'Excluded folders',
						desc: 'Includes subfolders.',
						render: (setting) => this.renderExcludedFoldersSetting(setting),
					},
				],
			},
			{
				type: 'group',
				heading: 'Debug',
				items: [
					{
						name: 'Show error notifications',
						desc: 'Every unexpected error already goes to the developer console. Turn this on to also see a copyable notification for it - useful while reporting a bug, noisy for everyday use, which is why it defaults off.',
						control: { type: 'toggle', key: 'debugMode' },
					},
				],
			},
		];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Diagnostics panel').setHeading();
		containerEl.createEl('p', {
			text: 'Choose which sections the diagnostics panel (stethoscope icon, in the graph view) shows.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Orphans')
			.setDesc('Notes with no links in or out.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.diagnostics.showOrphans).onChange(async (value) => {
					this.plugin.settings.diagnostics.showOrphans = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Broken links')
			.setDesc(
				'Links that don\'t resolve to a note. Turn this off if you deliberately link to notes that don\'t exist yet ("stub first, write later") and don\'t want them flagged.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.diagnostics.showBrokenLinks).onChange(async (value) => {
					this.plugin.settings.diagnostics.showBrokenLinks = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Isolated clusters')
			.setDesc("Groups of linked notes that aren't connected to the rest of the vault.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.diagnostics.showIsolatedClusters).onChange(async (value) => {
					this.plugin.settings.diagnostics.showIsolatedClusters = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Structural deviation')
			.setDesc('Groups of heavily-linked notes scattered across several different folders.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.diagnostics.showStructuralDeviation).onChange(async (value) => {
					this.plugin.settings.diagnostics.showStructuralDeviation = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName('Find path').setHeading();
		containerEl.createEl('p', {
			text: 'Notes and folders every Find-path search leaves out entirely (e.g. a big MOC/index note, or a whole "Archive" folder, you never want a route hopping through) - excluded notes also get a ring while Find-path is open, so you can see which ones at a glance. Configured only here, not in the Find-path dialog itself.',
			cls: 'setting-item-description',
		});
		this.renderExcludedNotesSetting(new Setting(containerEl).setName('Excluded notes'));
		this.renderExcludedFoldersSetting(new Setting(containerEl).setName('Excluded folders').setDesc('Includes subfolders.'));

		new Setting(containerEl).setName('Debug').setHeading();
		new Setting(containerEl)
			.setName('Show error notifications')
			.setDesc(
				'Every unexpected error already goes to the developer console. Turn this on to also see a copyable notification for it - useful while reporting a bug, noisy for everyday use, which is why it defaults off.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debugMode).onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}),
			);
	}

	/**
	 * Vault-wide default for pathfindingExcludedNotes - a note picker +
	 * removable chips, same clew-filter-pill pattern GraphPane's own panels
	 * use elsewhere for a list like this (e.g. a `tag` criterion's pills).
	 * User feedback: "In Find path keine Einstellung von Dokumenten, die
	 * ausgeschlossen werden. Nur in globalen Settings" - an earlier version
	 * also let the Find-path dialog itself add/remove notes per search;
	 * this Settings-tab list is now the only place exclusions are
	 * configured at all.
	 *
	 * Every add/remove also calls GraphPane.getActive()?.
	 * refreshPathfindingExclusions() - user feedback: "Wenn Setting
	 * geändert wird, dann wird der Graph nicht aktualisiert. Das ist ein
	 * Fehler." This settings tab is a separate screen with no event bus
	 * back to a live GraphPane, so without an explicit push here, an
	 * already-open graph view (mid Find-path search) would keep showing
	 * whichever notes were excluded when it last repainted, not what's
	 * actually configured now. getActive() returns null harmlessly when no
	 * graph view is open at all.
	 */
	/**
	 * Takes an already-constructed, already-named `Setting` rather than a
	 * bare `containerEl` - shared verbatim between display() (which builds
	 * the Setting itself, pre-1.13 fallback) and getSettingDefinitions()'s
	 * `render` definition (which gets one handed to it, already carrying
	 * the definition's own name/desc, 1.13+ declarative path) - see this
	 * class's own docstring for why both call the same helper. The chip
	 * list mounts as `setting.settingEl`'s next sibling (same relative
	 * position the original single-`containerEl` version had) - `!` is
	 * safe here, a `Setting` handed to either caller is always already
	 * attached to a real parent by the time this runs.
	 */
	private renderExcludedNotesSetting(pickerSetting: Setting): void {
		const containerEl = pickerSetting.settingEl.parentElement!;
		const chipsEl = containerEl.createDiv({ cls: 'clew-filter-pills' });

		const renderChips = (): void => {
			chipsEl.empty();
			this.plugin.settings.pathfindingExcludedNotes.forEach((path, index) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				const label = file instanceof TFile ? file.basename : path;
				const pill = chipsEl.createDiv({ cls: 'clew-filter-pill' });
				pill.createSpan({ text: label });
				const removeButton = pill.createSpan({ cls: 'clew-filter-pill-remove' });
				setIcon(removeButton, 'x');
				setTooltip(removeButton, 'Remove');
				removeButton.addEventListener('click', () => {
					this.plugin.settings.pathfindingExcludedNotes.splice(index, 1);
					void this.plugin.saveSettings();
					GraphPane.getActive()?.refreshPathfindingExclusions();
					renderChips();
				});
			});
		};

		pickerSetting.addText((text) => {
			text.setPlaceholder('Add a note to exclude…');
			const suggest = new NoteSuggest(this.app, text.inputEl, this.app.vault.getMarkdownFiles());
			suggest.onSelect((file) => {
				if (!this.plugin.settings.pathfindingExcludedNotes.includes(file.path)) {
					this.plugin.settings.pathfindingExcludedNotes.push(file.path);
					void this.plugin.saveSettings();
					GraphPane.getActive()?.refreshPathfindingExclusions();
					renderChips();
				}
				suggest.setValue('');
				suggest.close();
			});
		});

		renderChips();
	}

	/**
	 * Vault-wide default for pathfindingExcludedFolders - same picker +
	 * removable-chip pattern as renderExcludedNotesSetting() above, a
	 * FolderSuggest in place of NoteSuggest. User feedback: "In Settings
	 * sollen ganze Ordner ausgeschlossen werden." Every note under a listed
	 * folder (including subfolders - same convention as nodeGroups.ts's
	 * `folder` criterion) is excluded, resolved alongside
	 * pathfindingExcludedNotes by GraphPane's own resolveExcludedNodePaths()
	 * - nothing downstream distinguishes a folder-excluded note from an
	 * individually-excluded one.
	 */
	/** Same shared-helper shape as renderExcludedNotesSetting() above - see that method's own docstring. */
	private renderExcludedFoldersSetting(pickerSetting: Setting): void {
		const containerEl = pickerSetting.settingEl.parentElement!;
		const chipsEl = containerEl.createDiv({ cls: 'clew-filter-pills' });

		const renderChips = (): void => {
			chipsEl.empty();
			this.plugin.settings.pathfindingExcludedFolders.forEach((path, index) => {
				const pill = chipsEl.createDiv({ cls: 'clew-filter-pill' });
				pill.createSpan({ text: path });
				const removeButton = pill.createSpan({ cls: 'clew-filter-pill-remove' });
				setIcon(removeButton, 'x');
				setTooltip(removeButton, 'Remove');
				removeButton.addEventListener('click', () => {
					this.plugin.settings.pathfindingExcludedFolders.splice(index, 1);
					void this.plugin.saveSettings();
					GraphPane.getActive()?.refreshPathfindingExclusions();
					renderChips();
				});
			});
		};

		pickerSetting.addText((text) => {
			text.setPlaceholder('Add a folder to exclude…');
			// `false` - no root folder ("/") option, excluding the entire
			// vault has no sensible meaning here (Find-path would never
			// find anything).
			const suggest = new FolderSuggest(this.app, text.inputEl, this.app.vault.getAllFolders(false));
			suggest.onSelect((folder: TFolder) => {
				if (!this.plugin.settings.pathfindingExcludedFolders.includes(folder.path)) {
					this.plugin.settings.pathfindingExcludedFolders.push(folder.path);
					void this.plugin.saveSettings();
					GraphPane.getActive()?.refreshPathfindingExclusions();
					renderChips();
				}
				suggest.setValue('');
				suggest.close();
			});
		});

		renderChips();
	}
}
