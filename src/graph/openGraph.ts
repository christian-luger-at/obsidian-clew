import { App, TFile } from 'obsidian';

const GRAPH_BASE_FILENAME = 'Clew Graph.base';

const DEFAULT_GRAPH_BASE = ['filters: file.ext == "md"', 'views:', '  - type: clew-graph', '    name: Graph', ''].join(
	'\n',
);

/**
 * "Open graph" command/ribbon target. Reuses the vault's existing
 * Clew-managed Base if one exists - so any filter the user has since added
 * to it is preserved across opens - or creates a sensible default (every
 * markdown note, single Graph view) the first time.
 *
 * This is a shortcut to a Base, not a Bases-independent view: the node set
 * still comes entirely from that Base's filter, which is the whole point of
 * Clew vs. the core Graph View (product-vision doc, section 1). It just
 * removes the need to navigate the file tree to reach it.
 */
export async function openGraph(app: App): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(GRAPH_BASE_FILENAME);
	const file =
		existing instanceof TFile ? existing : await app.vault.create(GRAPH_BASE_FILENAME, DEFAULT_GRAPH_BASE);
	await app.workspace.getLeaf(true).openFile(file);
}
