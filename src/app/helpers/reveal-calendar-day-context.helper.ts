/** Show the start of an inline day panel without scrolling its selected date away. */
export function revealCalendarDayContext(root: HTMLElement): void {
  const grid = root.querySelector<HTMLElement>('app-activity-calendar-grid');
  const panel = root.querySelector<HTMLElement>('app-calendar-day-context');
  const selected = grid?.querySelector<HTMLElement>('.activity-calendar-day--selected');
  if (!grid || !panel || !selected) return;

  const gridRect = grid.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  if (panelRect.top < gridRect.bottom - 8) return; // Side-by-side desktop layout.

  let scrollOwner: HTMLElement | null = root.parentElement;
  const view = root.ownerDocument.defaultView;
  while (scrollOwner && view) {
    const overflow = view.getComputedStyle(scrollOwner).overflowY;
    if (/auto|scroll/.test(overflow) && scrollOwner.scrollHeight > scrollOwner.clientHeight) break;
    scrollOwner = scrollOwner.parentElement;
  }
  if (!scrollOwner?.scrollBy) return;

  const viewport = scrollOwner.getBoundingClientRect();
  const desiredPanelTop = viewport.bottom - Math.min(220, viewport.height * 0.35);
  const needed = Math.max(0, panelRect.top - desiredPanelTop);
  const keepSelectedVisible = Math.max(0, selected.getBoundingClientRect().top - viewport.top - 88);
  const distance = Math.min(needed, keepSelectedVisible);
  if (distance < 1) return;
  scrollOwner.scrollBy({
    top: distance,
    behavior: view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth',
  });
}
