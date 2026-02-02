import { Injectable } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';

interface IconConfig {
    name: string;
    path: string;
}

@Injectable({
    providedIn: 'root'
})
export class AppIconService {

    private readonly ICONS: IconConfig[] = [
        { name: 'logo', path: 'assets/logos/app/logo.svg' },
        { name: 'logo-font', path: 'assets/logos/app/logo-font.svg' },
        { name: 'suunto', path: 'assets/logos/suunto.svg' },
        { name: 'garmin', path: 'assets/logos/garmin.svg' },
        { name: 'coros', path: 'assets/logos/coros.svg' },
        { name: 'amcharts', path: 'assets/logos/amcharts.svg' },
        { name: 'firebase', path: 'assets/logos/firebase.svg' },
        { name: 'google_logo_light', path: 'assets/logos/google_logo_light.svg' },
        { name: 'facebook_logo', path: 'assets/logos/facebook_logo.svg' },
        { name: 'twitter_logo', path: 'assets/logos/twitter_logo.svg' },
        { name: 'github_logo', path: 'assets/logos/github_logo.svg' },
        { name: 'antigravity', path: 'assets/logos/antigravity.svg' },

        { name: 'epoc', path: 'assets/icons/epoc.svg' },
        { name: 'paypal', path: 'assets/icons/paypal.svg' },
    ];

    constructor(
        private matIconRegistry: MatIconRegistry,
        private domSanitizer: DomSanitizer
    ) { }

    public registerIcons(): void {
        this.ICONS.forEach(icon => {
            this.matIconRegistry.addSvgIcon(
                icon.name,
                this.domSanitizer.bypassSecurityTrustResourceUrl(icon.path)
            );
        });
    }
}
