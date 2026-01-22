
import { TestBed } from '@angular/core/testing';
import { MarkerFactoryService } from './marker-factory.service';
import { describe, it, expect, beforeEach } from 'vitest';

describe('MarkerFactoryService', () => {
    let service: MarkerFactoryService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(MarkerFactoryService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should create pin marker', () => {
        const marker = service.createPinMarker('#ff0000');
        expect(marker.innerHTML).toContain('<svg');
        expect(marker.innerHTML).toContain('scale(0.5) translate(22, 48)');
        expect(marker.innerHTML).toContain('fill="#ff0000"');
    });

    it('should create home marker', () => {
        const marker = service.createHomeMarker('#00ff00');
        expect(marker.innerHTML).toContain('<svg');
        expect(marker.innerHTML).toContain('M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z');
        expect(marker.innerHTML).toContain('fill="#00ff00"');
    });

    it('should create flag marker', () => {
        const marker = service.createFlagMarker('#0000ff');
        expect(marker.innerHTML).toContain('<svg');
        expect(marker.innerHTML).toContain('M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z');
        expect(marker.innerHTML).toContain('fill="#0000ff"');
    });

    it('should create cursor marker', () => {
        const marker = service.createCursorMarker('#123456');
        expect(marker.innerHTML).toContain('<svg');
        expect(marker.innerHTML).toContain('fill="#123456"');
    });

    it('should create lap marker with index', () => {
        const marker = service.createLapMarker('#abcdef', 5);
        expect(marker.innerHTML).toContain('<svg');
        // Check for index + 1
        expect(marker.textContent?.trim()).toContain('6');
        expect(marker.innerHTML).toContain('fill="#abcdef"');
        expect(marker.innerHTML).toContain('filter="url(#shadow-5-');
    });

    it('should create point marker', () => {
        const marker = service.createPointMarker('#654321');
        expect(marker.innerHTML).toContain('<svg');
        expect(marker.innerHTML).toContain('circle cx="5" cy="5" r="4"');
        expect(marker.innerHTML).toContain('fill="#654321"');
    });

    it('should create event marker', () => {
        const marker = service.createEventMarker('#aaaaaa');
        expect(marker.innerHTML).toContain('<svg');
        expect(marker.innerHTML).toContain('circle cx="10" cy="10" r="8"');
        expect(marker.innerHTML).toContain('fill="#aaaaaa"');
    });

    it('should create small cluster marker (< 10)', () => {
        const marker = service.createClusterMarker(5);
        expect(marker.textContent).toBe('5');
        expect(marker.style.borderRadius).toBe('50%');
        expect(marker.style.background).toContain('var(--mat-sys-primary');
    });

    it('should create medium cluster marker (10-99)', () => {
        const marker = service.createClusterMarker(42);
        expect(marker.textContent).toBe('42');
        expect(marker.style.borderRadius).toBe('50%');
        expect(marker.style.background).toContain('var(--mat-sys-secondary');
    });

    it('should create large cluster marker (>= 100)', () => {
        const marker = service.createClusterMarker(150);
        expect(marker.textContent).toBe('150');
        expect(marker.style.borderRadius).toBe('50%');
        expect(marker.style.background).toContain('var(--mat-sys-error');
    });
});
