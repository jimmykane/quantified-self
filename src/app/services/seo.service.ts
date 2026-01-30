import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter, map, mergeMap } from 'rxjs/operators';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

@Injectable({
    providedIn: 'root'
})
export class SeoService {

    constructor(
        private titleService: Title,
        private metaService: Meta,
        private router: Router,
        private activatedRoute: ActivatedRoute,
        @Inject(DOCUMENT) private doc: Document,
        @Inject(PLATFORM_ID) private platformId: object
    ) { }

    public init() {
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd),
            map(() => this.activatedRoute),
            map(route => {
                while (route.firstChild) {
                    route = route.firstChild;
                }
                return route;
            }),
            filter(route => route.outlet === 'primary'),
            mergeMap(route => route.data)
        ).subscribe(data => {
            this.updateTitle(data['title']);
            this.updateMetaTags(data);
            this.updateCanonicalTag();
            this.updateJsonLd();
        });
    }

    private updateTitle(title: string) {
        if (title) {
            const fullTitle = `${title} - Quantified Self`;
            this.titleService.setTitle(fullTitle);
            this.metaService.updateTag({ property: 'og:title', content: fullTitle });
            this.metaService.updateTag({ name: 'twitter:title', content: fullTitle });
        } else {
            this.titleService.setTitle('Quantified Self');
        }
    }

    private updateMetaTags(data: any) {
        // Description
        if (data['description']) {
            this.metaService.updateTag({ name: 'description', content: data['description'] });
            this.metaService.updateTag({ property: 'og:description', content: data['description'] });
            this.metaService.updateTag({ name: 'twitter:description', content: data['description'] });
        }

        // Keywords
        if (data['keywords']) {
            this.metaService.updateTag({ name: 'keywords', content: data['keywords'] });
        }

        // URL
        this.updateOgUrl();
    }

    private updateOgUrl() {
        if (isPlatformBrowser(this.platformId)) {
            // Use the clean canonical URL for og:url as well to prevent duplicate content issues
            const url = this.createCanonicalUrl();
            this.metaService.updateTag({ property: 'og:url', content: url });
        }
    }

    private updateCanonicalTag() {
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }

        const url = this.createCanonicalUrl();
        let link: HTMLLinkElement | null = this.doc.querySelector('link[rel="canonical"]');

        if (!link) {
            link = this.doc.createElement('link');
            link.setAttribute('rel', 'canonical');
            this.doc.head.appendChild(link);
        }

        link.setAttribute('href', url);
    }

    private createCanonicalUrl(): string {
        // Get the current URL from the router, which by default generally doesn't include 
        // query params unless we are manually accessing router.url.
        // However, router.url DOES include query params.
        // We want to trip them.

        const urlTree = this.router.parseUrl(this.router.url);
        // Clear query params
        urlTree.queryParams = {};
        urlTree.fragment = null; // Clear fragment

        // Serialize back to string
        const cleanPath = urlTree.toString();

        // Ensure we have the full absolute URL
        // We can use window.location.origin since we are in the browser (checked by isPlatformBrowser)
        // or configure a BASE_URL injection token for SSR safety if needed later.
        // For now, assuming browser or existing doc.location usage pattern.

        // Use document.location.origin if available, otherwise hardcode or config
        const origin = this.doc.location ? this.doc.location.origin : 'https://quantified-self.io';

        return `${origin}${cleanPath}`;
    }

    private updateJsonLd() {
        if (this.router.url === '/') {
            this.setJsonLd({
                "@context": "https://schema.org",
                "@type": "SoftwareApplication",
                "name": "Quantified Self",
                "applicationCategory": "HealthApplication",
                "operatingSystem": "Web",
                "description": "A premium analytical tool for your activity data.",
                "offers": {
                    "@type": "Offer",
                    "price": "0",
                    "priceCurrency": "USD"
                }
            });
        } else {
            this.removeJsonLd();
        }
    }

    private setJsonLd(data: any) {
        if (isPlatformBrowser(this.platformId)) {
            let script = this.doc.querySelector('script[type="application/ld+json"]');
            if (!script) {
                script = this.doc.createElement('script');
                script.setAttribute('type', 'application/ld+json');
                this.doc.head.appendChild(script);
            }
            script.textContent = JSON.stringify(data);
        }
    }

    private removeJsonLd() {
        if (isPlatformBrowser(this.platformId)) {
            const script = this.doc.querySelector('script[type="application/ld+json"]');
            if (script) {
                this.doc.head.removeChild(script);
            }
        }
    }
}
