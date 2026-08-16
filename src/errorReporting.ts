import { Notice, setIcon } from 'obsidian';

/** Prefixes every console.error() this module makes, so Clew's own errors are visually identifiable among Obsidian's/other plugins' own console noise without needing DevTools filtering. */
const CONSOLE_PREFIX = '[Clew]';

/** `throw` can raise any value, not just an `Error` - a plain string/object is rare but shouldn't itself crash the reporter. `Error` objects are the only ones with a real `stack`. */
function describeError(error: unknown): { message: string; stack?: string } {
	if (error instanceof Error) return { message: error.message, stack: error.stack };
	return { message: String(error) };
}

/**
 * Backlog "Rang 7", "Fehlerhandling": every code path that catches (or
 * globally observes, see main.ts's `window` `error`/`unhandledrejection`
 * listeners) an unexpected error in Clew's own code should call this
 * instead of a bare `console.error()`.
 *
 * Always logs to the console first, unconditionally - that's the existing
 * baseline this feature adds *on top of*, not a replacement for it, so
 * nothing about console-based debugging regresses regardless of the
 * setting below. Additionally shows a sticky, copyable `Notice` when
 * `debugMode` is on (`settings.ts`'s `debugMode`, **off by default** - user
 * feedback: "Dieses Feature kann in den Settings abgeschaltet werden
 * (Debug = Ja/Nein) [...] Standardwert für Setting = Nein"). `duration: 0`
 * - the notice never auto-hides, so there's actually time to read and copy
 * an error before it's gone, unlike Obsidian's default toast timing.
 */
export function reportError(context: string, error: unknown, debugMode: boolean): void {
	console.error(`${CONSOLE_PREFIX} ${context}:`, error);
	if (!debugMode) return;

	const { message, stack } = describeError(error);
	// User feedback: "Die Fehlermeldung soll kopierbar sein, damit sie
	// gleich weiterverarbeitet werden kann" - the full text (context +
	// message + stack, not just the one-line message) is what actually
	// gets copied, since a stack trace is what a bug report/GitHub issue
	// needs, not just "something went wrong". The visible notice shows the
	// context line once, as its own heading, then the message/stack below -
	// `fullText` (what actually lands on the clipboard) repeats the context
	// line inside itself instead of assuming the heading, since a pasted
	// clipboard has no heading of its own to lean on.
	const heading = `Clew error: ${context}`;
	const fullText = `${heading}\n${message}${stack ? `\n\n${stack}` : ''}`;

	const fragment = createFragment();
	const containerEl = fragment.createDiv({ cls: 'clew-error-notice' });
	containerEl.createDiv({ cls: 'clew-error-notice-context', text: heading });
	containerEl.createEl('pre', { cls: 'clew-error-notice-text', text: fullText.slice(heading.length + 1) });
	const copyButton = containerEl.createEl('button', { cls: 'clew-error-notice-copy' });
	setIcon(copyButton, 'copy');
	copyButton.createSpan({ text: 'Copy' });
	// stopPropagation() - Obsidian's own Notice dismisses itself on any
	// click inside it; without this, clicking Copy would also immediately
	// close the notice, defeating "read it, then copy it" (and any second
	// copy attempt).
	copyButton.addEventListener('click', (evt) => {
		evt.stopPropagation();
		void navigator.clipboard.writeText(fullText);
		copyButton.empty();
		setIcon(copyButton, 'check');
		copyButton.createSpan({ text: 'Copied' });
		window.setTimeout(() => {
			copyButton.empty();
			setIcon(copyButton, 'copy');
			copyButton.createSpan({ text: 'Copy' });
		}, 1500);
	});

	new Notice(fragment, 0);
}
