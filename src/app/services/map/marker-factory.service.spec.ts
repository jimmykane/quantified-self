
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

    const testCases = [
        { count: 2, bg: 'rgb(255, 145, 0)' },   // #FF9100
        { count: 7, bg: 'rgb(255, 109, 0)' },   // #FF6D00
        { count: 15, bg: 'rgb(245, 124, 0)' },  // #F57C00
        { count: 35, bg: 'rgb(230, 81, 0)' },   // #E65100
        { count: 75, bg: 'rgb(255, 61, 0)' },   // #FF3D00
        { count: 150, bg: 'rgb(213, 0, 0)' },   // #D50000
        { count: 350, bg: 'rgb(183, 28, 28)' }, // #B71C1C
        { count: 750, bg: 'rgb(139, 0, 0)' },   // #8B0000
        { count: 1500, bg: 'rgb(74, 0, 0)' },   // #4A0000
        { count: 5000, bg: 'rgb(33, 0, 0)' }    // #210000
    ];

    testCases.forEach(({ count, bg }) => {
        it(`should create cluster marker for count ${count} with background ${bg}`, () => {
            const marker = service.createClusterMarker(count);
            expect(marker.textContent).toBe(String(count));
            expect(marker.style.background).toContain(bg);
        });
    });
});
