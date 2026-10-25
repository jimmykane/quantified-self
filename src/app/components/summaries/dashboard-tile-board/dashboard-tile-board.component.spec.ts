import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DashboardTileBoardComponent } from './dashboard-tile-board.component';
import { CoalescedFrameTask } from '../../../helpers/coalesced-frame-task';

describe('DashboardTileBoardComponent', () => {
  let fixture: ComponentFixture<DashboardTileBoardComponent>;
  let component: DashboardTileBoardComponent;

  async function createBoardFixture() {
    await TestBed.configureTestingModule({
      declarations: [DashboardTileBoardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardTileBoardComponent);
    component = fixture.componentInstance;
  }

  it('should expose dashboard grid sizing through host CSS variables', async () => {
    await createBoardFixture();
    component.cols = 3;
    component.rowHeight = '180px';

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('qs-glass-card-panel')).toBe(true);
    expect(host.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('3');
    expect(host.style.getPropertyValue('--dashboard-tile-board-row-height')).toBe('180px');
    expect(host.style.getPropertyValue('--dashboard-tile-board-divider')).toBe('1px solid var(--qs-glass-panel-border, var(--mat-sys-outline-variant))');
    expect(host.style.getPropertyValue('--dashboard-tile-cell-inline-divider')).toBe('var(--dashboard-tile-board-divider)');
  });

  it('should fall back to a single column and default row height for invalid inputs', async () => {
    await createBoardFixture();
    component.cols = 0;
    component.rowHeight = null;

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('1');
    expect(host.style.getPropertyValue('--dashboard-tile-board-row-height')).toBe('150px');
    expect(host.style.getPropertyValue('--dashboard-tile-cell-inline-divider')).toBe('0');
  });

  it('disconnects layout observation and removes its resize listener on destruction', async () => {
    const disconnect = vi.fn();
    const disconnectMutations = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); unobserve = vi.fn(); disconnect = disconnect; });
    vi.stubGlobal('MutationObserver', class { observe = vi.fn(); disconnect = disconnectMutations; });
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      await createBoardFixture();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.destroy();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(disconnectMutations).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    } finally {
      vi.unstubAllGlobals();
      remove.mockRestore();
    }
  });

  it('does not schedule alignment for chart tooltips but still schedules summary changes', async () => {
    const request = vi.spyOn(CoalescedFrameTask.prototype, 'request').mockImplementation(() => {});
    try {
      await createBoardFixture();
      fixture.detectChanges();
      await fixture.whenStable();
      const host = fixture.nativeElement as HTMLElement;
      host.innerHTML = '<header>Source</header><div data-dashboard-chart-plot><div>Tooltip</div></div>';
      await Promise.resolve();
      request.mockClear();
      const tooltip = host.querySelector('[data-dashboard-chart-plot] div')!;
      for (let i = 0; i < 60; i++) tooltip.textContent = `Reading ${i}`;
      await Promise.resolve();
      expect(request).not.toHaveBeenCalled();
      host.querySelector('header')!.textContent = 'A longer source';
      await Promise.resolve();
      expect(request).toHaveBeenCalledOnce();
    } finally {
      fixture.destroy();
      request.mockRestore();
    }
  });

  it('sizes the calendar row from its month layout without a stale height floor', () => {
    const boardStyles = readFileSync(
      resolve(process.cwd(), 'src/app/components/summaries/dashboard-tile-board/dashboard-tile-board.component.css'),
      'utf8',
    );
    const ownerStyles = readFileSync(
      resolve(process.cwd(), 'src/app/components/summaries/summaries.component.css'),
      'utf8',
    );
    const calendarStyles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-tile/activity-calendar-tile.component.scss'),
      'utf8',
    );

    expect(boardStyles).toContain('grid-auto-rows: minmax(var(--dashboard-tile-board-row-height, 150px), auto);');
    expect(ownerStyles).not.toMatch(/\.dashboard-calendar-cell\s*\{[^}]*min-height:/);
    expect(calendarStyles).toContain('.activity-calendar-day-layout { display: grid; position: relative; height: auto; flex: none;');
    expect(calendarStyles).toContain('.activity-calendar-month-pane { min-width: 0; height: auto; flex: none; }');
    expect(calendarStyles).not.toContain('height: 360px');
    expect(calendarStyles).toContain('.activity-calendar-day-layout { grid-template-columns: minmax(0, 1fr); gap: 13px; }');
    expect(calendarStyles).toContain('app-calendar-day-context { position: static; grid-column: 1; grid-row: 2; height: auto;');
    expect(ownerStyles).not.toContain('min-height: 760px');
  });
});
