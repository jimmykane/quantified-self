import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DashboardTileCellComponent } from './dashboard-tile-cell.component';

describe('DashboardTileCellComponent', () => {
  let fixture: ComponentFixture<DashboardTileCellComponent>;
  let component: DashboardTileCellComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [DashboardTileCellComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardTileCellComponent);
    component = fixture.componentInstance;
  });

  it('should span the requested dashboard columns and rows', () => {
    component.columns = 2;
    component.rows = 3;
    component.maxColumns = 4;

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('dashboard-grid-tile')).toBe(true);
    expect(host.style.gridColumn).toBe('span 2');
    expect(host.style.gridRow).toBe('span 3');
  });

  it('should clamp columns to the current board column count', () => {
    component.columns = 4;
    component.rows = 1;
    component.maxColumns = 2;

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.gridColumn).toBe('span 2');
    expect(host.style.gridRow).toBe('span 1');
  });

  it('should fall back to one-by-one sizing for invalid inputs', () => {
    component.columns = 0;
    component.rows = -1;
    component.maxColumns = 0;

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.gridColumn).toBe('span 1');
    expect(host.style.gridRow).toBe('span 1');
  });

  it('should render board-provided row and column divider borders', () => {
    const stylePath = resolve(process.cwd(), 'src/app/components/summaries/dashboard-tile-cell/dashboard-tile-cell.component.css');
    const styles = readFileSync(stylePath, 'utf8');

    expect(styles).toContain('border-block-end: var(--dashboard-tile-cell-block-divider, var(--dashboard-tile-board-divider, 0));');
    expect(styles).toContain('border-inline-end: var(--dashboard-tile-cell-inline-divider, var(--dashboard-tile-board-divider, 0));');
  });

  it('should square loading shades inside joined dashboard board cells', () => {
    const stylePath = resolve(process.cwd(), 'src/app/components/summaries/dashboard-tile-cell/dashboard-tile-cell.component.css');
    const styles = readFileSync(stylePath, 'utf8');

    expect(styles).toContain('--loading-shade-border-radius: 0;');
  });
});
