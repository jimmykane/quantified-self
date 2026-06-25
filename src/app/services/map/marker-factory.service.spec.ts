
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
        expect(marker.innerHTML).toContain('viewBox="0 0 24 24"');
        expect(marker.innerHTML).toContain('C8.13 2 5 5.13 5 9');
        expect(marker.innerHTML).not.toContain('scale(0.5) translate(22, 48)');
        expect(marker.innerHTML).toContain('fill="#ff0000"');
    });

    it('should create accessible icon pin marker', () => {
        const marker = service.createIconPinMarker({
            color: '#0277bd',
            icon: 'water_drop',
            title: 'Water stop',
            ariaLabel: 'Waypoint Water stop, Water',
        });

        expect(marker.title).toBe('Water stop');
        expect(marker.getAttribute('aria-label')).toBe('Waypoint Water stop, Water');
        expect(marker.getAttribute('role')).toBe('img');
        expect(marker.style.position).toBe('absolute');
        expect(marker.textContent).toContain('water_drop');
        expect(marker.querySelector('path')?.getAttribute('fill')).toBe('#0277bd');
    });

    it('should create accessible compact icon marker', () => {
        const marker = service.createCompactIconMarker({
            color: '#3949ab',
            icon: 'turn_sharp_right',
            title: 'Sharp right',
            ariaLabel: 'Waypoint Sharp right, Sharp right turn',
        });

        expect(marker.title).toBe('Sharp right');
        expect(marker.getAttribute('aria-label')).toBe('Waypoint Sharp right, Sharp right turn');
        expect(marker.getAttribute('role')).toBe('img');
        expect(marker.style.position).toBe('absolute');
        expect(marker.style.width).toBe('22px');
        expect(marker.style.height).toBe('22px');
        expect(marker.style.borderRadius).toBe('50%');
        expect(marker.style.backgroundColor).toBe('rgb(57, 73, 171)');
        expect(marker.textContent).toContain('turn_sharp_right');
        expect(marker.querySelector('svg')).toBeNull();
    });

    it('should create compact icon marker with a centered route turn glyph', () => {
        const marker = service.createCompactIconMarker({
            color: '#3949ab',
            icon: 'turn_sharp_right',
            svgPath: 'M8 12h9m-3.5-3.5L17 12l-3.5 3.5',
            title: 'Sharp right',
            ariaLabel: 'Waypoint Sharp right, Sharp right turn',
        });

        const svg = marker.querySelector('svg');
        const path = marker.querySelector('path');
        expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(path?.getAttribute('d')).toBe('M8 12h9m-3.5-3.5L17 12l-3.5 3.5');
        expect(path?.getAttribute('stroke')).toBe('#fff');
        expect(path?.getAttribute('fill')).toBe('none');
        expect(marker.textContent).not.toContain('turn_sharp_right');
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

    it('should create jump marker with default size', () => {
        const marker = service.createJumpMarker('#123123');
        expect(marker.innerHTML).toContain('<svg');
        expect(marker.innerHTML).toContain('width="28"');
        expect(marker.innerHTML).toContain('height="28"');
        expect(marker.innerHTML).toContain('fill="#123123"');
    });

    it('should create jump marker with provided size', () => {
        const marker = service.createJumpMarker('#321321', 34);
        expect(marker.innerHTML).toContain('<svg');
        expect(marker.innerHTML).toContain('width="34"');
        expect(marker.innerHTML).toContain('height="34"');
        expect(marker.innerHTML).toContain('fill="#321321"');
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
