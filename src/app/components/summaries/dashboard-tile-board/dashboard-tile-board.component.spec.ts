import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
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
  });

  it('should fall back to a single column and default row height for invalid inputs', () => {
    component.cols = 0;
    component.rowHeight = null;

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('1');
    expect(host.style.getPropertyValue('--dashboard-tile-board-row-height')).toBe('150px');
  });
});
