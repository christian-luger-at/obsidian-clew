import { App, Modal, setIcon } from 'obsidian';

/**
 * 'force' is the only mode with live physics (ForceAtlas2) and the only one
 * dragging (GraphPane.setupNodeDragging) or pinning (finishDrag) works
 * against - the other three lay the whole graph out fresh from a pure
 * function each time, with no per-node "leave this one alone" concept.
 */
export type LayoutMode = 'force' | 'hierarchical' | 'radial' | 'circular';

export const LAYOUT_MODE_LABELS: Record<LayoutMode, string> = {
	force: 'Force',
	hierarchical: 'Hierarchical',
	radial: 'Radial',
	circular: 'Circular',
};

interface LayoutOption {
	mode: LayoutMode;
	description: string;
}

/** What each layout is actually *for*, in plain language - see the layout modules' own docstrings (hierarchicalLayout.ts, radialLayout.ts, circularLayout.ts) for the underlying algorithm each of these summarizes. */
const LAYOUT_OPTIONS: LayoutOption[] = [
	{
		mode: 'force',
		description:
			'The default. Physics pulls linked notes toward each other, so related notes settle into organic clusters - the best general-purpose overview of how the whole vault connects.',
	},
	{
		mode: 'hierarchical',
		description:
			'Arranges notes top-down by link direction, like a tree or outline. Best when the vault has a real hierarchy - MOCs, outlines, structured notes - that a physics-based clustering would otherwise obscure.',
	},
	{
		mode: 'radial',
		description:
			'Rings every note out from one you pick, by link distance - its direct links on the first ring, their links on the next, and so on. Best for "how does the rest of the vault relate to this one note?".',
	},
	{
		mode: 'circular',
		description:
			"Places every note evenly around a single circle. The simplest arrangement for spotting recurring connection patterns as arcs across the circle - patterns force layout's clustering can hide.",
	},
];

/**
 * "Layout" toolbar button's dialog - replaced an earlier dropdown menu
 * (Obsidian's own Menu API) that only listed each mode's bare name - user
 * feedback: picking a layout should come with an explanation of what each
 * one is actually useful for, not just a name. Radial is handled slightly
 * differently from the other three: it always needs a focus note chosen
 * first (see radialLayout.ts's docstring), so clicking its row routes to
 * `onPickRadial` (GraphPane's existing note-picker modal) instead of
 * `onSelect`, the same way the old menu's radial item always opened that
 * picker regardless of whether radial was already active.
 *
 * Each option is one whole clickable row (not a Setting with a small
 * per-row button off to the side) - user feedback that the per-row
 * buttons "fühlen sich nicht gut an" (didn't feel good): a tiny click
 * target at the row's edge, disconnected from the name/description text
 * that's the actual reason you'd pick that row, plus a disabled "Active"
 * button that read as broken rather than as a selection indicator. A
 * radio-card list - the whole row selects, the active one gets an accent
 * border/background and a checkmark instead of a greyed-out button - is
 * the more standard shape for "pick one of a few, each with a
 * description" and needs no explanation of what the button does.
 */
export class LayoutModal extends Modal {
	constructor(
		app: App,
		private readonly currentMode: LayoutMode,
		private readonly hierarchicalDisabled: boolean,
		private readonly onSelect: (mode: LayoutMode) => void,
		private readonly onPickRadial: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Layout' });
		contentEl.createEl('p', {
			text: "Choose how notes are arranged. Switching layout doesn't change the current filter or coloring, just the positions.",
			cls: 'clew-modal-description',
		});

		const listEl = contentEl.createDiv({ cls: 'clew-layout-option-list' });

		for (const option of LAYOUT_OPTIONS) {
			const isActive = this.currentMode === option.mode;
			const isRadial = option.mode === 'radial';
			const isDisabled = option.mode === 'hierarchical' && this.hierarchicalDisabled;

			const rowEl = listEl.createDiv({ cls: 'clew-layout-option' });
			rowEl.toggleClass('is-active', isActive);
			rowEl.toggleClass('is-disabled', isDisabled);

			const textEl = rowEl.createDiv({ cls: 'clew-layout-option-text' });
			textEl.createDiv({ cls: 'clew-layout-option-name', text: LAYOUT_MODE_LABELS[option.mode] });
			textEl.createDiv({
				cls: 'clew-layout-option-desc',
				text: isDisabled ? `${option.description} (Too many notes for this layout.)` : option.description,
			});

			// Trailing indicator: a checkmark for the active mode (replacing
			// the old disabled "Active" button), plus - for radial
			// specifically, active or not - an explicit hint that clicking it
			// opens the note picker rather than just re-selecting it (see
			// this class's own docstring for why radial always needs that
			// extra step). Every other, non-active, non-disabled row gets a
			// plain chevron as a "clicking this switches to it" affordance.
			const trailingEl = rowEl.createDiv({ cls: 'clew-layout-option-trailing' });
			if (isActive) setIcon(trailingEl.createSpan({ cls: 'clew-layout-option-check' }), 'check');
			if (isRadial) {
				trailingEl.createSpan({
					cls: 'clew-layout-option-hint',
					text: isActive ? 'Choose a different note…' : 'Choose note…',
				});
			}
			if (!isDisabled && (!isActive || isRadial)) setIcon(trailingEl.createSpan(), 'chevron-right');

			if (isDisabled) continue; // nothing to select - no click handler at all

			rowEl.addEventListener('click', () => {
				this.close();
				if (isRadial) this.onPickRadial();
				else this.onSelect(option.mode);
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
