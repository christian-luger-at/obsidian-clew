import { App, PluginSettingTab, Setting, setIcon, setTooltip, TFile, TFolder } from 'obsidian';
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
 */
export class ClewSettingTab extends PluginSettingTab {
	private readonly plugin: ClewPlugin;

	constructor(app: App, plugin: ClewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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

		new Setting(containerEl).setName('Default filters & colors').setHeading();
		containerEl.createEl('p', {
			text: 'Ready-made filters/color groups, one per node type. Available in the graph view\'s Filter/Color & size panels - each still needs its own checkbox turned on there to actually apply.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Default filters')
			.setDesc('"Show existing notes" / "Non-existent links" / "Attachments" / "Tags" in the Filter panel.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showDefaultFilters).onChange(async (value) => {
					this.plugin.settings.showDefaultFilters = value;
					this.plugin.syncDefaultPresets();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Default color groups')
			.setDesc('"Non-existent links" / "Attachments" / "Tags" in the Color & size panel.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showDefaultColorGroups).onChange(async (value) => {
					this.plugin.settings.showDefaultColorGroups = value;
					this.plugin.syncDefaultPresets();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName('Find path').setHeading();
		containerEl.createEl('p', {
			text: 'Notes and folders every Find-path search leaves out entirely (e.g. a big MOC/index note, or a whole "Archive" folder, you never want a route hopping through) - excluded notes also get a ring while Find-path is open, so you can see which ones at a glance. Configured only here, not in the Find-path dialog itself.',
			cls: 'setting-item-description',
		});
		this.renderExcludedNotesSetting(containerEl);
		this.renderExcludedFoldersSetting(containerEl);
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
	private renderExcludedNotesSetting(containerEl: HTMLElement): void {
		const pickerSetting = new Setting(containerEl).setName('Excluded notes');
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
	private renderExcludedFoldersSetting(containerEl: HTMLElement): void {
		const pickerSetting = new Setting(containerEl).setName('Excluded folders').setDesc('Includes subfolders.');
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
