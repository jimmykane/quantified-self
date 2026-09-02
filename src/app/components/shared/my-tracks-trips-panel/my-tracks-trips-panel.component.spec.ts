import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaterialModule } from '../../../modules/material.module';
import { PeekPanelComponent } from '../peek-panel/peek-panel.component';
import { MyTracksTripsPanelComponent, type MyTracksTripPanelItem } from './my-tracks-trips-panel.component';

describe('MyTracksTripsPanelComponent', () => {
  let fixture: ComponentFixture<MyTracksTripsPanelComponent>;
  const trip: MyTracksTripPanelItem = {
    tripId: 'trip-epirus',
    destinationId: 'destination-epirus',
    destinationVisitIndex: 1,
    destinationVisitCount: 1,
    isRevisit: false,
    eventIds: ['event-1'],
    locationLabel: 'Ioannina, Greece',
    startDate: new Date('2026-08-18T00:00:00Z'),
    endDate: new Date('2026-08-21T00:00:00Z'),
    activityCount: 2,
    centroidLat: 39.66,
    centroidLng: 20.84,
    bounds: { west: 20.82, east: 20.86, south: 39.64, north: 39.68 },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [MyTracksTripsPanelComponent, PeekPanelComponent],
      imports: [CommonModule, MaterialModule],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(MyTracksTripsPanelComponent);
    fixture.componentRef.setInput('trips', [trip]);
    fixture.componentRef.setInput('expanded', true);
    fixture.componentRef.setInput('homeArea', {
      destinationId: 'destination-home',
      pointCount: 42,
      pointShare: 0.7,
      centroidLat: 37.98,
      centroidLng: 23.72,
      bounds: { west: 23.69, east: 23.75, south: 37.95, north: 38.01 },
      radiusKm: 4,
    });
    fixture.detectChanges();
  });

  it('renders Home before its trip rows and exposes the shared sort control', () => {
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.trip-location'))
      .map((element: Element) => element.textContent?.trim());

    expect(labels).toEqual(['Home', 'Ioannina, Greece']);
    expect(fixture.nativeElement.querySelector(
      'button[aria-label="Showing newest trips first. Show oldest trips first."]',
    )).not.toBeNull();
  });

  it('emits trip, Home, sort, and panel actions without owning map state', () => {
    const component = fixture.componentInstance;
    const tripSelected = vi.fn();
    const homeSelected = vi.fn();
    const sortToggled = vi.fn();
    const panelExpanded = vi.fn();
    component.tripSelected.subscribe(tripSelected);
    component.homeSelectedChange.subscribe(homeSelected);
    component.sortToggle.subscribe(sortToggled);
    component.panelExpandedChange.subscribe(panelExpanded);

    const buttons = fixture.nativeElement.querySelectorAll('.detected-trip-button') as NodeListOf<HTMLButtonElement>;
    buttons[1]?.click();
    buttons[0]?.click();
    (fixture.nativeElement.querySelector(
      'button[aria-label="Showing newest trips first. Show oldest trips first."]',
    ) as HTMLButtonElement)?.click();
    (fixture.nativeElement.querySelector('.peek-toggle') as HTMLButtonElement)?.click();

    expect(tripSelected).toHaveBeenCalledWith(trip);
    expect(homeSelected).toHaveBeenCalledTimes(1);
    expect(sortToggled).toHaveBeenCalledTimes(1);
    expect(panelExpanded).toHaveBeenCalledWith(false);
  });
});
