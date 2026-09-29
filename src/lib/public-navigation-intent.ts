const publicNavigationIntentEvent = "diesel:public-navigation-intent";

/** Classify the activation only; the anchor's destination stays with its caller. */
export function isUnmodifiedPrimaryClick(event: Pick<
  MouseEvent,
  "altKey" | "button" | "ctrlKey" | "defaultPrevented" | "metaKey" | "shiftKey"
>): boolean {
  return !event.defaultPrevented && event.button === 0 &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

/** Called by Link.onNavigate, before Next starts an in-document navigation. */
export function notifyPublicNavigationIntent(): void {
  window.dispatchEvent(new Event(publicNavigationIntentEvent));
}

/** Subscribe only in a client effect; importing this module is SSR-safe. */
export function subscribeToPublicNavigationIntent(
  listener: () => void,
): () => void {
  // Capture the current document's window so cleanup removes the same listener.
  const target = window;
  target.addEventListener(publicNavigationIntentEvent, listener);
  return () => target.removeEventListener(publicNavigationIntentEvent, listener);
}
