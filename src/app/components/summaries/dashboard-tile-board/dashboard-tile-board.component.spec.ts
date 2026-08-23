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

  it('reserves a full-height mobile row only for activity-calendar boards', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/summaries/dashboard-tile-board/dashboard-tile-board.component.css'),
      'utf8',
    );

    expect(styles).toContain('@media (max-width: 860px)');
    expect(styles).toContain(':host(.dashboard-tile-board--activity-calendar)');
    expect(styles).toContain('grid-auto-rows: max(var(--dashboard-tile-board-row-height, 150px), 360px);');
  });
});
