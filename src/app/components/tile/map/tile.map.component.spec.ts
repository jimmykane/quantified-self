import { Component, EventEmitter, Input, NO_ERRORS_SCHEMA, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { TileMapComponent } from './tile.map.component';
import { ActivityTypes } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-tile-map-actions',
  template: '',
  standalone: false,
})
class MockTileMapActionsComponent {
  @Input() user: any;
  @Input() order?: number;
  @Input() size: any;
  @Input() type: any;
  @Output() editInDashboardManager = new EventEmitter<number>();
}

@Component({
  selector: 'app-dashboard-tile-event-filters',
  template: '',
  standalone: false,
})
class MockDashboardTileEventFiltersComponent {
  @Input() eventFilters: any;
  @Input() canNavigateNewer = false;
  @Output() rangeChange = new EventEmitter<any>();
  @Output() activityTypesChange = new EventEmitter<any>();
  @Output() navigate = new EventEmitter<any>();
}

describe('TileMapComponent', () => {
  let fixture: ComponentFixture<TileMapComponent>;
  let component: TileMapComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TileMapComponent, MockTileMapActionsComponent, MockDashboardTileEventFiltersComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(TileMapComponent);
    component = fixture.componentInstance;
    component.showActions = true;
    component.events = [];
    component.clusterMarkers = true;
    component.mapStyle = 'default';
    fixture.detectChanges();
  });

  it('should re-emit dashboard manager edit requests from map tile actions', () => {
    const emittedOrders: number[] = [];
    component.editInDashboardManager.subscribe((order) => emittedOrders.push(order));

    const actionsDebugElement = fixture.debugElement.query(By.directive(MockTileMapActionsComponent));
    const actions = actionsDebugElement.componentInstance as MockTileMapActionsComponent;
    actions.editInDashboardManager.emit(5);

    expect(emittedOrders).toEqual([5]);
  });

  it('should render and re-emit event filter controls', () => {
    const eventFilters = { range: '90d' as const, activityTypes: [] };
    fixture.componentRef.setInput('eventFilters', eventFilters);
    fixture.componentRef.setInput('canNavigateTileEventsNewer', true);
    const ranges: string[] = [];
    const activitySelections: ActivityTypes[][] = [];
    const directions: string[] = [];
    component.eventFilterRangeChange.subscribe(range => ranges.push(range));
    component.eventFilterActivityTypesChange.subscribe(activityTypes => activitySelections.push(activityTypes));
    component.eventFilterNavigate.subscribe(direction => directions.push(direction));

    fixture.detectChanges();

    const filters = fixture.debugElement.query(By.directive(MockDashboardTileEventFiltersComponent))
      .componentInstance as MockDashboardTileEventFiltersComponent;
    expect(filters.eventFilters).toEqual(eventFilters);
    expect(filters.canNavigateNewer).toBe(true);

    filters.rangeChange.emit('30d');
    filters.activityTypesChange.emit([ActivityTypes.Cycling]);
    filters.navigate.emit('newer');

    expect(ranges).toEqual(['30d']);
    expect(activitySelections).toEqual([[ActivityTypes.Cycling]]);
    expect(directions).toEqual(['newer']);
  });

  it('should render a visible drag handle button for desktop drag mode', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/map/tile.map.component.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).toContain('button mat-icon-button cdkDragHandle class="drag-handle-indicator"');
    expect(template).toContain('drag_indicator');
  });
});
