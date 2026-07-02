import { DOCUMENT } from '@angular/common';
import { Component, Inject, OnDestroy } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
    hasAngularServerContext,
    isRouteLoaderSuppressedStartupDocument,
    isSameDocumentRoutePath,
} from '../../shared/public-startup-route';

@Component({
    selector: 'app-route-loader',
    templateUrl: './route-loader.component.html',
    styleUrls: ['./route-loader.component.scss'],
    standalone: false
})
export class RouteLoaderComponent implements OnDestroy {
    public isLoading = false;
    private routerSubscription: Subscription;
    private suppressInitialSameDocumentNavigation: boolean;

    constructor(
        private router: Router,
        @Inject(DOCUMENT) private documentRef: Document,
    ) {
        this.suppressInitialSameDocumentNavigation =
            hasAngularServerContext(this.documentRef) || isRouteLoaderSuppressedStartupDocument(this.documentRef);

        // Check if there's an active navigation already (e.g. on initial page load)
        if (this.router.getCurrentNavigation()) {
            this.isLoading = !this.suppressInitialSameDocumentNavigation;
        }

        this.routerSubscription = this.router.events.subscribe((event) => {
            switch (true) {
                case event instanceof NavigationStart: {
                    if (this.shouldSuppressNavigation(event.url)) {
                        this.suppressInitialSameDocumentNavigation = false;
                        this.isLoading = false;
                        break;
                    }

                    this.suppressInitialSameDocumentNavigation = false;
                    this.isLoading = true;
                    break;
                }
                case event instanceof NavigationEnd:
                case event instanceof NavigationCancel:
                case event instanceof NavigationError: {
                    this.suppressInitialSameDocumentNavigation = false;
                    this.isLoading = false;
                    break;
                }
                default: {
                    break;
                }
            }
        });
    }

    ngOnDestroy(): void {
        if (this.routerSubscription) {
            this.routerSubscription.unsubscribe();
        }
    }

    private shouldSuppressNavigation(url: string): boolean {
        return this.suppressInitialSameDocumentNavigation && isSameDocumentRoutePath(this.documentRef, url);
    }
}
