import Graph from 'graphology';
import Sigma from 'sigma';
import { NodeImageProgram } from '@sigma/node-image';
import { GeneratedGraph } from './generateGraph';

const GRAPH_COLOR = '#7c3aed';
const IMAGE_NODE_COLOR = '#f59e0b';

/** Builds a graphology graph from generated data, with random initial positions (required before running FA2) and node styling. */
export function buildGraph(data: GeneratedGraph, imageUrlForNode: (nodeId: string) => string | undefined): Graph {
	const graph = new Graph();

	for (const node of data.nodes) {
		const image = node.hasImage ? imageUrlForNode(node.id) : undefined;
		graph.addNode(node.id, {
			label: node.label,
			x: Math.random(),
			y: Math.random(),
			size: image ? 6 : 3,
			color: image ? IMAGE_NODE_COLOR : GRAPH_COLOR,
			type: image ? 'image' : undefined,
			image,
		});
	}
	for (const edge of data.edges) {
		if (!graph.hasEdge(edge.source, edge.target)) {
			graph.addEdge(edge.source, edge.target);
		}
	}

	return graph;
}

export function createRenderer(graph: Graph, container: HTMLElement): Sigma {
	return new Sigma(graph, container, {
		nodeProgramClasses: { image: NodeImageProgram },
		renderEdgeLabels: false,
		defaultEdgeColor: '#8884',
	});
}
