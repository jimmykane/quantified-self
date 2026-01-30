import { TestBed } from '@angular/core/testing';

import { SeoService } from './seo.service';
import { Title, Meta } from '@angular/platform-browser';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
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
            url: '/',
            parseUrl: vi.fn().mockImplementation((url) => ({
                queryParams: {},
                fragment: null,
                toString: () => url.split('?')[0] // Simple default behavior
            }))
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
                href: 'https://quantified-self.io/',
                origin: 'https://quantified-self.io'
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

        // Mock router.parseUrl
        mockRouter.url = '/test';
        mockRouter.parseUrl = vi.fn().mockReturnValue({
            queryParams: {},
            fragment: null,
            toString: () => '/test'
        });

        service.init();

        routerEventsSubject.next(new NavigationEnd(1, '/test', '/test'));

        expect(titleServiceSpy.setTitle).toHaveBeenCalledWith('Test Page - Quantified Self');
        expect(metaServiceSpy.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Test Description' });
        expect(metaServiceSpy.updateTag).toHaveBeenCalledWith({ name: 'keywords', content: 'test, seo' });
        expect(metaServiceSpy.updateTag).toHaveBeenCalledWith({ property: 'og:title', content: 'Test Page - Quantified Self' });
        expect(metaServiceSpy.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Test Description' });
    });

    it('should inject JSON-LD on home page', () => {
        mockRouter.url = '/';
        mockRouter.parseUrl = vi.fn().mockReturnValue({
            queryParams: {},
            fragment: null,
            toString: () => '/'
        });
        mockActivatedRoute.data = of({ title: 'Home' });

        // Mock querySelector to return null so it creates new script
        mockDocument.querySelector = vi.fn().mockReturnValue(null);
        const mockScript = {
            setAttribute: vi.fn(),
            textContent: ''
        };
        mockDocument.createElement = vi.fn().mockReturnValue(mockScript);
        mockDocument.head.appendChild = vi.fn();

        service.init();
        routerEventsSubject.next(new NavigationEnd(1, '/', '/'));

        expect(mockDocument.createElement).toHaveBeenCalledWith('script');
        expect(mockScript.setAttribute).toHaveBeenCalledWith('type', 'application/ld+json');
        expect(mockDocument.head.appendChild).toHaveBeenCalledWith(mockScript);
        expect(mockScript.textContent).toContain('"@type":"SoftwareApplication"');
    });

    it('should remove JSON-LD on non-home page', () => {
        mockRouter.url = '/other';
        mockRouter.parseUrl = vi.fn().mockReturnValue({
            queryParams: {},
            fragment: null,
            toString: () => '/other'
        });
        mockActivatedRoute.data = of({ title: 'Other' });

        const mockScript = {};

        // Smarter mock to handle multiple selectors
        mockDocument.querySelector = vi.fn().mockImplementation((selector) => {
            if (selector === 'script[type="application/ld+json"]') {
                return mockScript;
            }
            if (selector === 'link[rel="canonical"]') {
                // Return a mock link with setAttribute
                return { setAttribute: vi.fn() };
            }
            return null;
        });

        mockDocument.head.removeChild = vi.fn();

        service.init();
        routerEventsSubject.next(new NavigationEnd(1, '/other', '/other'));

        expect(mockDocument.head.removeChild).toHaveBeenCalledWith(mockScript);
    });

    it('should set canonical url without query params', () => {
        mockActivatedRoute.data = of({ title: 'Canonical Test' });

        // Simulate a URL with query params
        mockRouter.url = '/products?foo=bar&utm_source=test';

        // Mock the parseUrl behavior to return a tree that can be stripped
        const mockUrlTree = {
            queryParams: { foo: 'bar' },
            fragment: null,
            toString: vi.fn().mockReturnValue('/products') // After stripping
        };
        mockRouter.parseUrl = vi.fn().mockReturnValue(mockUrlTree);

        // Mock document.querySelector for existing canonical
        mockDocument.querySelector = vi.fn().mockReturnValue(null);

        const mockLink = { setAttribute: vi.fn() };
        mockDocument.createElement = vi.fn().mockReturnValue(mockLink);
        mockDocument.head.appendChild = vi.fn();

        service.init();
        routerEventsSubject.next(new NavigationEnd(1, '/products?foo=bar', '/products?foo=bar'));

        // Verify query params were cleared on the tree
        expect(mockUrlTree.queryParams).toEqual({});

        // Verify canonical link creation
        expect(mockDocument.createElement).toHaveBeenCalledWith('link');
        expect(mockLink.setAttribute).toHaveBeenCalledWith('rel', 'canonical');
        expect(mockLink.setAttribute).toHaveBeenCalledWith('href', 'https://quantified-self.io/products');

        // Verify og:url
        expect(metaServiceSpy.updateTag).toHaveBeenCalledWith({
            property: 'og:url',
            content: 'https://quantified-self.io/products'
        });
    });

    it('should update existing canonical tag', () => {
        mockActivatedRoute.data = of({ title: 'Update Test' });

        mockRouter.url = '/updated';
        mockRouter.parseUrl = vi.fn().mockReturnValue({
            queryParams: {},
            fragment: null,
            toString: () => '/updated'
        });

        const mockLink = { setAttribute: vi.fn() };
        mockDocument.querySelector = vi.fn().mockReturnValue(mockLink);

        service.init();
        routerEventsSubject.next(new NavigationEnd(1, '/updated', '/updated'));

        expect(mockDocument.createElement).not.toHaveBeenCalled();
        expect(mockLink.setAttribute).toHaveBeenCalledWith('href', 'https://quantified-self.io/updated');
    });
});
