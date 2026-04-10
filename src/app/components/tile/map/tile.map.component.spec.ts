import { Component, EventEmitter, Input, NO_ERRORS_SCHEMA, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { TileMapComponent } from './tile.map.component';

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

describe('TileMapComponent', () => {
  let fixture: ComponentFixture<TileMapComponent>;
  let component: TileMapComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TileMapComponent, MockTileMapActionsComponent],
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

  it('should render a visible drag handle button for desktop drag mode', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/map/tile.map.component.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).toContain('button mat-icon-button cdkDragHandle class="drag-handle-indicator"');
    expect(template).toContain('drag_indicator');
  });
});
