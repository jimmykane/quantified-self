import { ComponentFixture, TestBed } from '@angular/core/testing';
import { encodeRoutePolyline5 } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { RoutePreviewThumbnailComponent } from './route-preview-thumbnail.component';

describe('RoutePreviewThumbnailComponent', () => {
  let fixture: ComponentFixture<RoutePreviewThumbnailComponent>;
  let component: RoutePreviewThumbnailComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoutePreviewThumbnailComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RoutePreviewThumbnailComponent);
    component = fixture.componentInstance;
  });

  it('renders route preview path data with an accessible label', () => {
    fixture.componentRef.setInput('routeName', 'Morning Route');
    fixture.componentRef.setInput('preview', {
      version: 1,
      encoding: 'polyline5',
      precision: 5,
      sourcePointCount: 2,
      pointCount: 2,
      segments: [{
        id: 'segment-1',
        name: 'Main segment',
        sourcePointCount: 2,
        pointCount: 2,
        encodedPolyline: encodeRoutePolyline5([
          { latitudeDegrees: 39.1, longitudeDegrees: 20.1 },
          { latitudeDegrees: 39.2, longitudeDegrees: 20.2 },
        ]),
      }],
    });

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.route-preview-thumbnail')?.getAttribute('aria-label')).toBe('Preview map for Morning Route');
    expect(host.querySelector('.route-preview-thumbnail-line')?.getAttribute('d')).toBe('M 6 50 L 90 6');
    expect(host.querySelector('title')?.textContent).toBe('Main segment');
  });

  it('renders a stable placeholder when preview data is missing', () => {
    fixture.componentRef.setInput('routeName', 'Old Route');
    fixture.componentRef.setInput('preview', null);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(component.thumbnail()).toBeNull();
    expect(host.querySelector('.route-preview-thumbnail')?.classList.contains('route-preview-thumbnail--empty')).toBe(true);
    expect(host.querySelector('.route-preview-thumbnail')?.getAttribute('aria-label')).toBe('No preview map available for Old Route');
    expect(host.querySelector('.route-preview-thumbnail-placeholder-line')).toBeTruthy();
  });
});
