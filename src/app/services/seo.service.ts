import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { Router, NavigationEnd, ActivatedRoute, RoutesRecognized } from '@angular/router';
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
        @Inject(PLATFORM_ID) private platformId: Object
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
            this.updateJsonLd(data);
        });

        // Also handle RoutesRecognized for immediate title updates if needed, though NavigationEnd is safer for data
        // The original AppComponent logic used RoutesRecognized for title. 
        // NavigationEnd is standard for SEO as it confirms the nav is done.
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
        } else {
            // Fallback or remove? keeping existing if not present might be safer or standard default
        }

        // Keywords
        if (data['keywords']) {
            this.metaService.updateTag({ name: 'keywords', content: data['keywords'] });
        }

        // URL
        if (isPlatformBrowser(this.platformId)) {
            const url = this.doc.location.href;
            this.metaService.updateTag({ property: 'og:url', content: url });
        }
    }

    private updateJsonLd(data: any) {
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
