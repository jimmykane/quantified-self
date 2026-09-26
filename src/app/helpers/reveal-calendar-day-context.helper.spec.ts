import { revealCalendarDayContext } from './reveal-calendar-day-context.helper';

describe('revealCalendarDayContext', () => {
  const fixtures: HTMLElement[] = [];

  afterEach(() => {
    fixtures.splice(0).forEach(element => element.remove());
  });

  it('reveals a stacked day panel while keeping the selected date visible', () => {
    const { root, grid, panel, selected, scrollBy } = setup(fixtures);
    mockRect(grid, 332, 843);
    mockRect(panel, 859, 1300);
    mockRect(selected, 380, 440);

    revealCalendarDayContext(root);

    expect(scrollBy).toHaveBeenCalledWith({ top: 235, behavior: 'smooth' });
  });

  it('caps scrolling when the selected date is near the top and leaves side-by-side layouts alone', () => {
    const { root, grid, panel, selected, scrollBy } = setup(fixtures);
    mockRect(grid, 332, 843);
    mockRect(panel, 859, 1300);
    mockRect(selected, 120, 180);
    revealCalendarDayContext(root);
    expect(scrollBy).toHaveBeenCalledWith({ top: 32, behavior: 'smooth' });

    scrollBy.mockClear();
    mockRect(panel, 332, 900);
    revealCalendarDayContext(root);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

function setup(fixtures: HTMLElement[]) {
  const scrollOwner = document.createElement('div');
  scrollOwner.style.overflowY = 'auto';
  Object.defineProperties(scrollOwner, {
    scrollHeight: { configurable: true, value: 1600 },
    clientHeight: { configurable: true, value: 844 },
  });
  mockRect(scrollOwner, 0, 844);
  const scrollBy = vi.fn();
  scrollOwner.scrollBy = scrollBy;
  const root = document.createElement('div');
  const grid = document.createElement('app-activity-calendar-grid');
  const selected = document.createElement('button');
  selected.className = 'activity-calendar-day--selected';
  const panel = document.createElement('app-calendar-day-context');
  grid.append(selected);
  root.append(grid, panel);
  scrollOwner.append(root);
  document.body.append(scrollOwner);
  fixtures.push(scrollOwner);
  return { root, grid, panel, selected, scrollBy };
}

function mockRect(element: HTMLElement, top: number, bottom: number): void {
  element.getBoundingClientRect = () => ({ top, bottom, height: bottom - top } as DOMRect);
}
