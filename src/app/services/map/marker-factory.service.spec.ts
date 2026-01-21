import { TestBed } from '@angular/core/testing';
import { MarkerFactoryService } from './marker-factory.service';

describe('MarkerFactoryService', () => {
    let service: MarkerFactoryService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(MarkerFactoryService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should create a pin marker with correct color', () => {
        const color = '#FF0000';
        const element = service.createPinMarker(color);
        expect(element.tagName).toBe('DIV');
        expect(element.innerHTML).toContain(`fill="${color}"`);
        expect(element.innerHTML).toContain('path d="M22-48h-44v43h16l6 5 6-5h16z"');
    });

    it('should create a home marker with correct color', () => {
        const color = '#00FF00';
        const element = service.createHomeMarker(color);
        expect(element.innerHTML).toContain(`fill="${color}"`);
        expect(element.innerHTML).toContain('d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"');
    });

    it('should create a flag marker with correct color', () => {
        const color = '#0000FF';
        const element = service.createFlagMarker(color);
        expect(element.innerHTML).toContain(`fill="${color}"`);
        expect(element.innerHTML).toContain('d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"');
    });

    it('should create a cursor marker with correct color', () => {
        const color = '#FFFF00';
        const element = service.createCursorMarker(color);
        expect(element.innerHTML).toContain(`fill="${color}"`);
        expect(element.innerHTML).toContain('d="M5 15H3v4c0 1.1.9 2 2 2h4v-2H5v-4z');
    });

    it('should create a lap marker with unique filter ID', () => {
        const color = '#FF00FF';
        const index = 5;
        const element1 = service.createLapMarker(color, index);
        const element2 = service.createLapMarker(color, index);

        expect(element1.innerHTML).toContain(`fill="${color}"`);
        // Check for the text value (index + 1)
        expect(element1.textContent).toContain('6');

        // Extract filter IDs
        const filterId1Match = element1.innerHTML.match(/filter id="(shadow-\d+-\d+)"/);
        const filterId2Match = element2.innerHTML.match(/filter id="(shadow-\d+-\d+)"/);

        expect(filterId1Match).not.toBeNull();
        expect(filterId2Match).not.toBeNull();

        // IDs should be unique even for same index
        expect(filterId1Match![1]).not.toBe(filterId2Match![1]);
    });

    it('should create a point marker with correct color', () => {
        const color = '#00FFFF';
        const element = service.createPointMarker(color);
        expect(element.innerHTML).toContain(`fill="${color}"`);
        expect(element.innerHTML).toContain('<circle cx="5" cy="5" r="4"');
    });

    it('should create an event marker with correct color', () => {
        const color = '#000000';
        const element = service.createEventMarker(color);
        expect(element.innerHTML).toContain(`fill="${color}"`);
        expect(element.innerHTML).toContain('<circle cx="10" cy="10" r="8"');
    });

    it('should create a cluster marker with count', () => {
        const count = 42;
        const element = service.createClusterMarker(count);
        expect(element.textContent).toBe('42');
        expect(element.style.background).toBe('var(--mat-sys-primary, #4285F4)');
        expect(element.style.borderRadius).toBe('50%');
    });
});
