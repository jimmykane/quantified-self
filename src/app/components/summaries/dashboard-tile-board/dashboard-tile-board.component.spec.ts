import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DashboardTileBoardComponent } from './dashboard-tile-board.component';

describe('DashboardTileBoardComponent', () => {
  let fixture: ComponentFixture<DashboardTileBoardComponent>;
  let component: DashboardTileBoardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [DashboardTileBoardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardTileBoardComponent);
    component = fixture.componentInstance;
  });

  it('should expose dashboard grid sizing through host CSS variables', () => {
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

  it('should fall back to a single column and default row height for invalid inputs', () => {
    component.cols = 0;
    component.rowHeight = null;

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('1');
    expect(host.style.getPropertyValue('--dashboard-tile-board-row-height')).toBe('150px');
    expect(host.style.getPropertyValue('--dashboard-tile-cell-inline-divider')).toBe('0');
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

    expect(boardStyles).toContain(':host(.dashboard-tile-board--activity-calendar)');
    expect(boardStyles).toContain('grid-auto-rows: minmax(var(--dashboard-tile-board-row-height, 150px), auto);');
    expect(ownerStyles).not.toMatch(/\.dashboard-calendar-cell\s*\{[^}]*min-height:/);
    expect(calendarStyles).toContain('.activity-calendar-day-layout { display: grid; height: 360px; flex: none;');
    expect(calendarStyles).toContain('.activity-calendar-day-layout { height: auto; grid-template-columns: minmax(0, 1fr);');
    expect(ownerStyles).not.toContain('min-height: 760px');
  });
});
