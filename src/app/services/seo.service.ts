import { Injectable, Inject, OnDestroy, PLATFORM_ID } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter, map, mergeMap } from 'rxjs/operators';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Subscription } from 'rxjs';
import { environment } from '../../environments/environment';

const PRODUCTION_CANONICAL_ORIGIN = 'https://quantified-self.io';

@Injectable({
    providedIn: 'root'
})
export class SeoService implements OnDestroy {
    private routerEventsSubscription?: Subscription;

    constructor(
        private titleService: Title,
        private metaService: Meta,
        private router: Router,
        private activatedRoute: ActivatedRoute,
        @Inject(DOCUMENT) private doc: Document,
        @Inject(PLATFORM_ID) private platformId: object
    ) { }

    public init() {
        if (this.routerEventsSubscription && !this.routerEventsSubscription.closed) {
            return;
        }

        this.routerEventsSubscription = this.router.events.pipe(
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
            this.updateJsonLd(data);
        });
    }

    ngOnDestroy(): void {
        this.routerEventsSubscription?.unsubscribe();
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
        // Use the clean canonical URL for og:url as well to prevent duplicate content issues.
        const url = this.createCanonicalUrl();
        this.metaService.updateTag({ property: 'og:url', content: url });
    }

    private updateCanonicalTag() {
        if (!this.doc?.head) {
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

        const origin = isPlatformBrowser(this.platformId)
            ? this.doc.location?.origin ?? this.getConfiguredCanonicalOrigin()
            : this.getConfiguredCanonicalOrigin();

        return `${origin}${cleanPath}`;
    }

    private getConfiguredCanonicalOrigin(): string {
        try {
            const configuredOrigin = new URL(environment.appUrl).origin;
            return this.isLocalCanonicalOrigin(configuredOrigin)
                ? PRODUCTION_CANONICAL_ORIGIN
                : configuredOrigin;
        } catch {
            return PRODUCTION_CANONICAL_ORIGIN;
        }
    }

    private isLocalCanonicalOrigin(origin: string): boolean {
        try {
            const hostname = new URL(origin).hostname;
            return hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname === '[::1]' ||
                hostname === '::1';
        } catch {
            return true;
        }
    }

    private updateJsonLd(data: any) {
        if (data['jsonLd']) {
            this.setJsonLd(data['jsonLd']);
            return;
        }

        if (this.router.url === '/') {
            this.setJsonLd({
                "@context": "https://schema.org",
                "@type": "SoftwareApplication",
                "name": "Quantified Self",
                "applicationCategory": "HealthApplication",
                "operatingSystem": "Web",
                "description": "Quantified Self brings Garmin, Suunto, and COROS activity data into one private training dashboard with AI Insights and automatic sync from Garmin or COROS to Suunto.",
                "featureList": [
                    "AI Insights with chart-backed answers",
                    "Automatic Garmin -> Suunto sync for newly imported Garmin activities",
                    "Automatic COROS -> Suunto sync for newly imported COROS activities",
                    "Manual catch-up sync for events already stored in Quantified Self"
                ],
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
        if (!this.doc?.head) {
            return;
        }

        let script = this.doc.querySelector('script[type="application/ld+json"]');
        if (!script) {
            script = this.doc.createElement('script');
            script.setAttribute('type', 'application/ld+json');
            this.doc.head.appendChild(script);
        }
        script.textContent = JSON.stringify(data);
    }

    private removeJsonLd() {
        if (!this.doc?.head) {
            return;
        }

        const script = this.doc.querySelector('script[type="application/ld+json"]');
        if (script) {
            this.doc.head.removeChild(script);
        }
    }
}
