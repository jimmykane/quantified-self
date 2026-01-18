import { Injectable, inject } from '@angular/core';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';

@Injectable({
    providedIn: 'root'
})
export class AppDeepLinkService {
    private windowService = inject(AppWindowService);
    private logger = inject(LoggerService);

    /**
     * Attempts to open the Garmin Connect app.
     * On Android: Uses Intent URL for better reliability and fallback to Play Store/Web.
     * On iOS: Uses gcm-ciq:// scheme with web fallback.
     * On Desktop: Opens the Garmin Connect web URL.
     */
    public openGarminConnectApp(): void {
        const webUrl = 'https://connect.garmin.com/modern/account';
        const iosScheme = 'gcm-ciq://';
        const androidPackage = 'com.garmin.android.apps.connectmobile';

        // Detect platforms
        const userAgent = this.windowService.windowRef.navigator.userAgent.toLowerCase();
        const isAndroid = userAgent.includes('android');
        const isIOS = /iphone|ipad|ipod/.test(userAgent);

        if (isAndroid) {
            // Android Intent URL: if app is not installed, it helps navigate to Play Store or remains on web
            // Format: intent://<path>#Intent;scheme=<scheme>;package=<package>;S.browser_fallback_url=<url>;end
            // Using a simple intent that points to the package
            const intentUrl = `intent://#Intent;scheme=garmin;package=${androidPackage};S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
            this.windowService.windowRef.location.href = intentUrl;
            return;
        }

        if (isIOS) {
            // For iOS, try the custom scheme. 
            // We use a hidden iframe approach or just a window.open/location change.
            // Modern iOS browsers often handle this better with simple window.location if the user has the app.

            const start = Date.now();
            this.windowService.windowRef.location.href = iosScheme;

            // Fallback logic for iOS if app not installed (delay check)
            setTimeout(() => {
                if (Date.now() - start < 2000) {
                    this.windowService.windowRef.open(webUrl, '_blank');
                }
            }, 1500);
            return;
        }

        // Default/Desktop fallback
        this.windowService.windowRef.open(webUrl, '_blank');
    }
}
