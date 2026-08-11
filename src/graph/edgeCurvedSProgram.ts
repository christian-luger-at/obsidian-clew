import type { Attributes } from 'graphology-types';
import { EdgeProgram, EdgeProgramType, DEFAULT_EDGE_ARROW_HEAD_PROGRAM_OPTIONS, ProgramInfo } from 'sigma/rendering';
import { RenderParams, NodeDisplayData, EdgeDisplayData } from 'sigma/types';
import { floatColor } from 'sigma/utils';

/**
 * Backlog follow-up on "Curved edges" (renderer.ts's createEdgePrograms())
 * - user: "Es gibt aber 5 verschiedene Arten der Darstellung [...]
 * Berücksichtige alle", citing sigma v4's `pathLine`/`pathCurved`/
 * `pathStep`/`pathStepCurved`/`pathCurvedS`. Sigma v4 (and the node-border/
 * node-image packages this plugin also depends on for basically every
 * node) is still alpha/beta-only - not a foundation to build a shipped
 * plugin's whole node rendering on, see this feature's own DEVELOPMENT.md
 * entry for the exact version numbers checked. User decision: build
 * `pathCurvedS` by hand against the stable sigma v3 this plugin already
 * depends on, skip the two step variants.
 *
 * A true cubic Bézier (`pathCurvedS`'s actual shape - two control points,
 * bulging one way then the other) has no simple closed-form point-to-curve
 * distance the way a quadratic Bézier does (`@sigma/edge-curve`'s own
 * `distToQuadraticBezierCurve` - see this file's fragment shader,
 * unmodified from that package) - the usual real-time-rendering answer is
 * either an iterative numeric solver (slow, and a real risk of getting
 * subtly wrong per-pixel) or a polynomial approximation (also easy to get
 * subtly wrong, and hard to verify without live WebGL debugging this
 * environment doesn't have). Sidestepped entirely: this program splits
 * each edge at its own geometric midpoint and draws *two* ordinary
 * quadratic Bézier halves (source→midpoint bulging one way, midpoint→
 * target bulging the other) - visually reads as a single S-shaped curve
 * (the same way `pathCurvedS` is described - bulge, then the opposite
 * bulge), reuses `@sigma/edge-curve`'s exact, already-correct quadratic
 * distance math for both halves unmodified, and needs only one new
 * ingredient over that package's own vertex shader: a per-*vertex*
 * `a_half` flag (0 = first half, 1 = second half) picking which endpoint
 * pair (source/midpoint or midpoint/target) and which curvature sign that
 * vertex's half uses. The one visible tradeoff: the two halves aren't
 * perfectly tangent-continuous at the midpoint (a real cubic Bézier is,
 * this reads as an ever-so-slight kink there) - acceptable for a stylistic
 * edge-path choice, not a data-accuracy concern.
 *
 * Twice the geometry of `@sigma/edge-curve`'s own quadratic program (12
 * vertices/edge instead of 6 - two quads, one per half) - `processVisibleItem()`
 * still writes each edge's attributes exactly once, same as that package's
 * own; the doubled vertex count is handled entirely by `CONSTANT_DATA`
 * (two copies of the same 6-row quad pattern, differing only in the new
 * `a_half` column), the same mechanism sigma's own base `EdgeProgram`
 * class already uses to turn "one attribute write per edge" into "N
 * vertices per edge" for every built-in edge program, curved or not.
 */

interface ArrowHeadOptions {
	extremity: 'target' | 'source' | 'both';
	lengthToThicknessRatio: number;
	widenessToThicknessRatio: number;
}

export interface CreateEdgeCurvedSProgramOptions {
	arrowHead: null | ArrowHeadOptions;
	/** Edge data key read for this edge's curvature - same default key `@sigma/edge-curve` uses, so a curvature already set for `curved`/`curvedArrow` edges (not currently exposed as a per-edge setting in this plugin, but kept consistent for anyone reading/writing graph data directly) is honored here too. */
	curvatureAttribute: string;
	defaultCurvature: number;
}

const DEFAULT_CURVATURE = 0.25;

export const DEFAULT_EDGE_CURVED_S_PROGRAM_OPTIONS: CreateEdgeCurvedSProgramOptions = {
	arrowHead: null,
	curvatureAttribute: 'curvature',
	defaultCurvature: DEFAULT_CURVATURE,
};

function getVertexShader(arrowHead: ArrowHeadOptions | null): string {
	const hasTargetArrowHead = arrowHead?.extremity === 'target' || arrowHead?.extremity === 'both';
	const hasSourceArrowHead = arrowHead?.extremity === 'source' || arrowHead?.extremity === 'both';
	// language=GLSL
	return `
attribute vec4 a_id;
attribute vec4 a_color;
attribute float a_direction;
attribute float a_half;
attribute float a_thickness;
attribute vec2 a_source;
attribute vec2 a_target;
attribute float a_current;
attribute float a_curvature;
${hasTargetArrowHead ? 'attribute float a_targetSize;' : ''}
${hasSourceArrowHead ? 'attribute float a_sourceSize;' : ''}

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform vec2 u_dimensions;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;
${hasTargetArrowHead ? 'varying float v_targetSize;\nvarying vec2 v_targetPoint;' : ''}
${hasSourceArrowHead ? 'varying float v_sourceSize;\nvarying vec2 v_sourcePoint;' : ''}
${arrowHead ? 'uniform float u_widenessToThicknessRatio;' : ''}

const float bias = 255.0 / 254.0;
const float epsilon = 0.7;

vec2 clipspaceToViewport(vec2 pos, vec2 dimensions) {
  return vec2(
    (pos.x + 1.0) * dimensions.x / 2.0,
    (pos.y + 1.0) * dimensions.y / 2.0
  );
}

vec2 viewportToClipspace(vec2 pos, vec2 dimensions) {
  return vec2(
    pos.x / dimensions.x * 2.0 - 1.0,
    pos.y / dimensions.y * 2.0 - 1.0
  );
}

void main() {
  float minThickness = u_minEdgeThickness;

  // Split the edge at its own midpoint into two ordinary quadratic-Bézier
  // halves, bulging opposite ways - see this file's own docstring for why
  // (sidesteps needing real cubic-Bézier distance math). a_half (0 or 1,
  // constant per vertex, not per edge - see CONSTANT_DATA below) picks
  // which half *this* vertex belongs to.
  vec2 mid = 0.5 * (a_source + a_target);
  vec2 segSource = mix(a_source, mid, a_half);
  vec2 segTarget = mix(mid, a_target, a_half);
  float segCurvature = mix(a_curvature, -a_curvature, a_half);

  // Selecting the correct position
  // Branchless "position = segSource if a_current == 1.0 else segTarget"
  vec2 position = segSource * max(0.0, a_current) + segTarget * max(0.0, 1.0 - a_current);
  position = (u_matrix * vec3(position, 1)).xy;

  vec2 source = (u_matrix * vec3(segSource, 1)).xy;
  vec2 target = (u_matrix * vec3(segTarget, 1)).xy;

  vec2 viewportPosition = clipspaceToViewport(position, u_dimensions);
  vec2 viewportSource = clipspaceToViewport(source, u_dimensions);
  vec2 viewportTarget = clipspaceToViewport(target, u_dimensions);

  vec2 delta = viewportTarget.xy - viewportSource.xy;
  float len = length(delta);
  vec2 normal = vec2(-delta.y, delta.x) * a_direction;
  vec2 unitNormal = normal / max(len, 0.0000001);
  float boundingBoxThickness = len * segCurvature;

  float curveThickness = max(minThickness, a_thickness / u_sizeRatio);
  v_thickness = curveThickness * u_pixelRatio;
  v_feather = u_feather;

  v_cpA = viewportSource;
  v_cpB = 0.5 * (viewportSource + viewportTarget) + unitNormal * a_direction * boundingBoxThickness;
  v_cpC = viewportTarget;

  vec2 viewportOffsetPosition = (
    viewportPosition +
    unitNormal * (boundingBoxThickness / 2.0 + sign(boundingBoxThickness) * (${arrowHead ? 'curveThickness * u_widenessToThicknessRatio' : 'curveThickness'} + epsilon)) *
    max(0.0, a_direction) // NOTE: cutting the bounding box in half to avoid overdraw
  );

  position = viewportToClipspace(viewportOffsetPosition, u_dimensions);
  gl_Position = vec4(position, 0, 1);

${hasTargetArrowHead ? `  // Always the edge's real overall target (not the segment's own target -
  // the midpoint has no arrowhead), so the arrowhead only ever appears at
  // the true far end regardless of which half a given pixel belongs to.
  vec2 realTarget = (u_matrix * vec3(a_target, 1)).xy;
  v_targetSize = a_targetSize * u_pixelRatio / u_sizeRatio;
  v_targetPoint = clipspaceToViewport(realTarget, u_dimensions);
` : ''}
${hasSourceArrowHead ? `  vec2 realSource = (u_matrix * vec3(a_source, 1)).xy;
  v_sourceSize = a_sourceSize * u_pixelRatio / u_sizeRatio;
  v_sourcePoint = clipspaceToViewport(realSource, u_dimensions);
` : ''}

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`;
}

/**
 * Unmodified from `@sigma/edge-curve` (its exact `getFragmentShader()`
 * output, verified byte-for-byte against `node_modules/@sigma/edge-curve`
 * at the time this was written) - the per-half quadratic distance math is
 * identical, this program just calls it twice (once per half's quad,
 * driven by the vertex shader's `a_half` split) instead of once.
 */
function getFragmentShader(arrowHead: ArrowHeadOptions | null): string {
	const hasTargetArrowHead = arrowHead?.extremity === 'target' || arrowHead?.extremity === 'both';
	const hasSourceArrowHead = arrowHead?.extremity === 'source' || arrowHead?.extremity === 'both';
	// language=GLSL
	return `
precision highp float;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;
${hasTargetArrowHead ? 'varying float v_targetSize;\nvarying vec2 v_targetPoint;' : ''}
${hasSourceArrowHead ? 'varying float v_sourceSize;\nvarying vec2 v_sourcePoint;' : ''}
${arrowHead ? 'uniform float u_lengthToThicknessRatio;\nuniform float u_widenessToThicknessRatio;' : ''}

float det(vec2 a, vec2 b) {
  return a.x * b.y - b.x * a.y;
}

vec2 getDistanceVector(vec2 b0, vec2 b1, vec2 b2) {
  float a = det(b0, b2), b = 2.0 * det(b1, b0), d = 2.0 * det(b2, b1);
  float f = b * d - a * a;
  vec2 d21 = b2 - b1, d10 = b1 - b0, d20 = b2 - b0;
  vec2 gf = 2.0 * (b * d21 + d * d10 + a * d20);
  gf = vec2(gf.y, -gf.x);
  vec2 pp = -f * gf / dot(gf, gf);
  vec2 d0p = b0 - pp;
  float ap = det(d0p, d20), bp = 2.0 * det(d10, d0p);
  float t = clamp((ap + bp) / (2.0 * a + b + d), 0.0, 1.0);
  return mix(mix(b0, b1, t), mix(b1, b2, t), t);
}

float distToQuadraticBezierCurve(vec2 p, vec2 b0, vec2 b1, vec2 b2) {
  return length(getDistanceVector(b0 - p, b1 - p, b2 - p));
}

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  float dist = distToQuadraticBezierCurve(gl_FragCoord.xy, v_cpA, v_cpB, v_cpC);
  float thickness = v_thickness;
${hasTargetArrowHead ? `  float distToTarget = length(gl_FragCoord.xy - v_targetPoint);
  float targetArrowLength = v_targetSize + thickness * u_lengthToThicknessRatio;
  if (distToTarget < targetArrowLength) {
    thickness = (distToTarget - v_targetSize) / (targetArrowLength - v_targetSize) * u_widenessToThicknessRatio * thickness;
  }` : ''}
${hasSourceArrowHead ? `  float distToSource = length(gl_FragCoord.xy - v_sourcePoint);
  float sourceArrowLength = v_sourceSize + thickness * u_lengthToThicknessRatio;
  if (distToSource < sourceArrowLength) {
    thickness = (distToSource - v_sourceSize) / (sourceArrowLength - v_sourceSize) * u_widenessToThicknessRatio * thickness;
  }` : ''}

  float halfThickness = thickness / 2.0;
  if (dist < halfThickness) {
    #ifdef PICKING_MODE
    gl_FragColor = v_color;
    #else
    float t = smoothstep(
      halfThickness - v_feather,
      halfThickness,
      dist
    );

    gl_FragColor = mix(v_color, transparent, t);
    #endif
  } else {
    gl_FragColor = transparent;
  }
}
`;
}

const FLOAT = WebGLRenderingContext.FLOAT;
const UNSIGNED_BYTE = WebGLRenderingContext.UNSIGNED_BYTE;

/**
 * Two copies of the same 6-vertex quad pattern `@sigma/edge-curve` uses
 * for one quadratic curve ([a_current, a_direction] pairs) - the first six
 * rows get `a_half = 0` (the source→midpoint segment), the next six get
 * `a_half = 1` (the midpoint→target segment). `processVisibleItem()`
 * below still writes each edge's own attributes (source, target,
 * thickness, curvature, color, id) exactly once - the base `EdgeProgram`
 * class replicates that single write across all 12 of these rows on its
 * own, same mechanism as every other sigma edge program.
 */
const CONSTANT_DATA = [
	[0, 1, 0],
	[0, -1, 0],
	[1, 1, 0],
	[0, -1, 0],
	[1, 1, 0],
	[1, -1, 0],
	[0, 1, 1],
	[0, -1, 1],
	[1, 1, 1],
	[0, -1, 1],
	[1, 1, 1],
	[1, -1, 1],
];

export function createEdgeCurvedSProgram<N extends Attributes = Attributes, E extends Attributes = Attributes, G extends Attributes = Attributes>(
	inputOptions?: Partial<CreateEdgeCurvedSProgramOptions>,
): EdgeProgramType<N, E, G> {
	const options: CreateEdgeCurvedSProgramOptions = { ...DEFAULT_EDGE_CURVED_S_PROGRAM_OPTIONS, ...inputOptions };
	const { arrowHead, curvatureAttribute } = options;
	const hasTargetArrowHead = arrowHead?.extremity === 'target' || arrowHead?.extremity === 'both';
	const hasSourceArrowHead = arrowHead?.extremity === 'source' || arrowHead?.extremity === 'both';
	const uniforms = ['u_matrix', 'u_sizeRatio', 'u_dimensions', 'u_pixelRatio', 'u_feather', 'u_minEdgeThickness'].concat(
		arrowHead ? ['u_lengthToThicknessRatio', 'u_widenessToThicknessRatio'] : [],
	);

	return class EdgeCurvedSProgram extends EdgeProgram<string, N, E, G> {
		drawLabel = undefined;

		getDefinition() {
			return {
				VERTICES: 12,
				VERTEX_SHADER_SOURCE: getVertexShader(arrowHead),
				FRAGMENT_SHADER_SOURCE: getFragmentShader(arrowHead),
				METHOD: WebGLRenderingContext.TRIANGLES,
				UNIFORMS: uniforms,
				ATTRIBUTES: [
					{ name: 'a_source', size: 2, type: FLOAT },
					{ name: 'a_target', size: 2, type: FLOAT },
					...(hasTargetArrowHead ? [{ name: 'a_targetSize', size: 1, type: FLOAT }] : []),
					...(hasSourceArrowHead ? [{ name: 'a_sourceSize', size: 1, type: FLOAT }] : []),
					{ name: 'a_thickness', size: 1, type: FLOAT },
					{ name: 'a_curvature', size: 1, type: FLOAT },
					{ name: 'a_color', size: 4, type: UNSIGNED_BYTE, normalized: true },
					{ name: 'a_id', size: 4, type: UNSIGNED_BYTE, normalized: true },
				],
				CONSTANT_ATTRIBUTES: [
					{ name: 'a_current', size: 1, type: FLOAT },
					{ name: 'a_direction', size: 1, type: FLOAT },
					{ name: 'a_half', size: 1, type: FLOAT },
				],
				CONSTANT_DATA,
			};
		}

		processVisibleItem(edgeIndex: number, startIndex: number, sourceData: NodeDisplayData, targetData: NodeDisplayData, data: EdgeDisplayData): void {
			const thickness = data.size || 1;
			const color = floatColor(data.color);
			const curvatureValue = (data as unknown as Record<string, unknown>)[curvatureAttribute];
			const curvature = typeof curvatureValue === 'number' ? curvatureValue : DEFAULT_CURVATURE;
			const array = this.array;
			let i = startIndex;

			array[i++] = sourceData.x;
			array[i++] = sourceData.y;
			array[i++] = targetData.x;
			array[i++] = targetData.y;
			if (hasTargetArrowHead) array[i++] = targetData.size;
			if (hasSourceArrowHead) array[i++] = sourceData.size;
			array[i++] = thickness;
			array[i++] = curvature;
			array[i++] = color;
			array[i++] = edgeIndex;
		}

		setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo): void {
			const { u_matrix, u_pixelRatio, u_feather, u_sizeRatio, u_dimensions, u_minEdgeThickness } = uniformLocations;
			gl.uniformMatrix3fv(u_matrix!, false, params.matrix);
			gl.uniform1f(u_pixelRatio!, params.pixelRatio);
			gl.uniform1f(u_sizeRatio!, params.sizeRatio);
			gl.uniform1f(u_feather!, params.antiAliasingFeather);
			gl.uniform2f(u_dimensions!, params.width * params.pixelRatio, params.height * params.pixelRatio);
			gl.uniform1f(u_minEdgeThickness!, params.minEdgeThickness);
			if (arrowHead) {
				const { u_lengthToThicknessRatio, u_widenessToThicknessRatio } = uniformLocations;
				gl.uniform1f(u_lengthToThicknessRatio!, arrowHead.lengthToThicknessRatio);
				gl.uniform1f(u_widenessToThicknessRatio!, arrowHead.widenessToThicknessRatio);
			}
		}
	};
}

/** Same ratio defaults `createEdgePrograms()` scales for the straight/curved arrow variants - kept here too so a caller building just the curvedS-with-arrow variant on its own gets a sensible default without needing to import from renderer.ts. */
export const DEFAULT_CURVED_S_ARROW_HEAD = DEFAULT_EDGE_ARROW_HEAD_PROGRAM_OPTIONS;
