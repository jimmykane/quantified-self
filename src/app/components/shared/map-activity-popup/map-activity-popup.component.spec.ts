import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MapActivityPopupComponent } from './map-activity-popup.component';

describe('MapActivityPopupComponent', () => {
  let fixture: ComponentFixture<MapActivityPopupComponent>;
  let component: MapActivityPopupComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [MapActivityPopupComponent],
      imports: [CommonModule],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(MapActivityPopupComponent);
    component = fixture.componentInstance;
  });

  it('renders the compact route-style popup layout for map activity selections', () => {
    component.activityType = 'Mountain Biking';
    component.iconActivityType = 'Cycling';
    component.startDate = new Date(Date.UTC(2026, 6, 8, 10, 15));
    component.metrics = [
      { value: '1h 42m', label: 'Duration' },
      { value: '6.43', label: 'Km' },
      { value: '3.79', subValue: 'km/h', label: 'Speed' },
    ];
    component.actionLabel = 'Open activity';
    component.dismissible = true;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelector('app-summary-primary-info')).toBeNull();
    expect(nativeElement.querySelector('.track-start-popup-header')).toBeTruthy();
    expect(nativeElement.querySelector('.track-start-popup-header--dismissible')).toBeTruthy();
    expect(nativeElement.querySelector('.track-start-popup-icon app-activity-type-icon')).toBeTruthy();
    expect(nativeElement.querySelector('.track-start-popup-title')?.textContent?.trim()).toBe('Mountain Biking');
    expect(nativeElement.querySelector('.track-start-popup-meta')?.textContent).toContain('8 Jul 2026');
    expect(Array.from(nativeElement.querySelectorAll('.track-start-popup-metric strong')).map(element => element.textContent?.trim())).toEqual([
      '1h 42m',
      '6.43',
      '3.79 km/h',
    ]);
    expect(nativeElement.querySelector('.track-start-popup-actions button')?.textContent?.trim()).toBe('Open activity');
  });

  it('does not reserve close-button header space for non-dismissible popups', () => {
    component.activityType = 'Mountain Biking';
    component.dismissible = false;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelector('.track-start-popup-close')).toBeNull();
    expect(nativeElement.querySelector('.track-start-popup-header--dismissible')).toBeNull();
  });

  it('emits popup actions from the compact controls', () => {
    const actionSpy = vi.fn();
    const dismissSpy = vi.fn();
    component.actionClick.subscribe(actionSpy);
    component.dismiss.subscribe(dismissSpy);
    component.actionLabel = 'Open activity';
    component.dismissible = true;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    (nativeElement.querySelector('.track-start-popup-actions button') as HTMLButtonElement).click();
    (nativeElement.querySelector('.track-start-popup-close') as HTMLButtonElement).click();

    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps map activity popup styling aligned with the route popup primitive', () => {
    const stylesPath = resolve(process.cwd(), 'src/app/components/shared/map-activity-popup/map-activity-popup.component.scss');
    const routePopupStylesPath = resolve(process.cwd(), 'src/app/components/routes/route-preview-map/route-preview-map.component.css');
    const eventsMapStylesPath = resolve(process.cwd(), 'src/app/components/events-map/events-map.component.css');
    const tracksStylesPath = resolve(process.cwd(), 'src/app/components/tracks/tracks.component.scss');
    const styles = readFileSync(stylesPath, 'utf8');
    const routePopupStyles = readFileSync(routePopupStylesPath, 'utf8');
    const eventsMapStyles = readFileSync(eventsMapStylesPath, 'utf8');
    const tracksStyles = readFileSync(tracksStylesPath, 'utf8');

    expect(styles).toContain('width: min(280px, calc(100vw - 24px));');
    expect(styles).not.toMatch(/^\s*width:\s*100%;/m);
    expect(styles).toContain('grid-template-columns: 40px minmax(0, 1fr);');
    expect(styles).toContain('font: var(--mat-sys-title-small);');
    expect(styles).toContain("font-family: 'Barlow Condensed', var(--mat-sys-body-large-font), sans-serif;");
    expect(styles).toContain('font-weight: 500;');
    expect(routePopupStyles).toContain("font-family: 'Barlow Condensed', var(--mat-sys-body-large-font), sans-serif;");
    expect(routePopupStyles).toContain('font-weight: 500;');
    expect(eventsMapStyles).not.toContain('::ng-deep .events-map-popup-anchor app-map-activity-popup .track-start-popup');
    expect(tracksStyles).not.toContain('::ng-deep .track-start-popup-anchor app-map-activity-popup .track-start-popup');
  });
});
