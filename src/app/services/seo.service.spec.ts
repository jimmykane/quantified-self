import { TestBed } from '@angular/core/testing';

import { SeoService } from './seo.service';
import { Title, Meta } from '@angular/platform-browser';
import { Router, NavigationEnd, ActivatedRoute, Data } from '@angular/router';
import { Subject, of } from 'rxjs';
import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('SeoService', () => {
    let service: SeoService;
    let titleServiceSpy: any;
    let metaServiceSpy: any;
    let routerEventsSubject: Subject<any>;
    let mockRouter: any;
    let mockActivatedRoute: any;
    let mockDocument: any;

    beforeEach(() => {
        titleServiceSpy = { setTitle: vi.fn() };
        metaServiceSpy = { updateTag: vi.fn() };
        routerEventsSubject = new Subject<any>();

        // Mock Router
        mockRouter = {
            events: routerEventsSubject.asObservable(),
            url: '/'
        };

        // Mock ActivatedRoute
        mockActivatedRoute = {
            firstChild: null,
            outlet: 'primary',
            data: of({})
        };

        // Mock Document
        mockDocument = {
            createElement: vi.fn().mockReturnValue({
                setAttribute: vi.fn(),
                textContent: ''
            }),
            head: {
                appendChild: vi.fn(),
                removeChild: vi.fn()
            },
            querySelector: vi.fn(),
            location: {
                href: 'https://quantified-self.io/'
            }
        };

        TestBed.configureTestingModule({
            providers: [
                SeoService,
                { provide: Title, useValue: titleServiceSpy },
                { provide: Meta, useValue: metaServiceSpy },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: DOCUMENT, useValue: mockDocument },
                { provide: PLATFORM_ID, useValue: 'browser' }
            ]
        });
        service = TestBed.inject(SeoService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should update title and meta tags on NavigationEnd', () => {
        // Setup route data
        mockActivatedRoute.data = of({
            title: 'Test Page',
            description: 'Test Description',
            keywords: 'test, seo'
        });
        // Need to handle the "while (route.firstChild)" loop in service
        // For this simple test, our mockActivatedRoute has no firstChild, so it uses itself.

        service.init();

        routerEventsSubject.next(new NavigationEnd(1, '/test', '/test'));

        expect(titleServiceSpy.setTitle).toHaveBeenCalledWith('Test Page - Quantified Self');
        expect(metaServiceSpy.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Test Description' });
        expect(metaServiceSpy.updateTag).toHaveBeenCalledWith({ name: 'keywords', content: 'test, seo' });
        expect(metaServiceSpy.updateTag).toHaveBeenCalledWith({ property: 'og:title', content: 'Test Page - Quantified Self' });
        expect(metaServiceSpy.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Test Description' });
        expect(metaServiceSpy.updateTag).toHaveBeenCalledWith({ property: 'og:url', content: 'https://quantified-self.io/' });
    });

    it('should inject JSON-LD on home page', () => {
        mockRouter.url = '/';
        mockActivatedRoute.data = of({ title: 'Home' });

        // Mock querySelector to return null so it creates new script
        mockDocument.querySelector.mockReturnValue(null);
        const mockScript = {
            setAttribute: vi.fn(),
            textContent: ''
        };
        mockDocument.createElement.mockReturnValue(mockScript);

        service.init();
        routerEventsSubject.next(new NavigationEnd(1, '/', '/'));

        expect(mockDocument.createElement).toHaveBeenCalledWith('script');
        expect(mockScript.setAttribute).toHaveBeenCalledWith('type', 'application/ld+json');
        expect(mockDocument.head.appendChild).toHaveBeenCalledWith(mockScript);
        expect(mockScript.textContent).toContain('"@type":"SoftwareApplication"');
    });

    it('should remove JSON-LD on non-home page', () => {
        mockRouter.url = '/other';
        mockActivatedRoute.data = of({ title: 'Other' });

        const mockScript = {};
        mockDocument.querySelector.mockReturnValue(mockScript);

        service.init();
        routerEventsSubject.next(new NavigationEnd(1, '/other', '/other'));

        expect(mockDocument.head.removeChild).toHaveBeenCalledWith(mockScript);
    });
});
