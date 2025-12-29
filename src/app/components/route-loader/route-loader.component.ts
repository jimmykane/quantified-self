import { Component, OnDestroy } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
    selector: 'app-route-loader',
    templateUrl: './route-loader.component.html',
    styleUrls: ['./route-loader.component.scss'],
    standalone: false
})
export class RouteLoaderComponent implements OnDestroy {
    public isLoading = false;
    private routerSubscription: Subscription;

    constructor(private router: Router) {
        this.routerSubscription = this.router.events.subscribe((event) => {
            switch (true) {
                case event instanceof NavigationStart: {
                    this.isLoading = true;
                    break;
                }
                case event instanceof NavigationEnd:
                case event instanceof NavigationCancel:
                case event instanceof NavigationError: {
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
}
