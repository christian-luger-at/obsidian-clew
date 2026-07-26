import { BasesView, QueryController } from 'obsidian';
import { GraphPane } from './graphPane';

/**
 * The Bases-integrated graph view (product-vision doc, section 3.1 + the
 * path-finding feature in 3.2). Registered as `clew-graph` / "Graph" - node
 * set comes from the enclosing Base's filter. Distinct from
 * `clew-spike-graph` ("Graph (spike)", a dev-only perf/reference check) and
 * from StandaloneGraphView (node set = the whole vault, opened directly via
 * ribbon/command, no Base involved).
 */

export const CLEW_GRAPH_VIEW = 'clew-graph';

export class GraphView extends BasesView {
	type = CLEW_GRAPH_VIEW;

	private readonly pane: GraphPane;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.pane = new GraphPane(this.app, containerEl);
	}

	onDataUpdated(): void {
		this.pane.setFiles(this.data.data.map((entry) => entry.file));
	}

	onunload(): void {
		this.pane.destroy();
	}
}
