import { ErrorHandler, Injectable } from '@angular/core';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';

@Injectable({
    providedIn: 'root'
})
export class GlobalErrorHandler implements ErrorHandler {
    private readonly chunkReloadGuardKey = 'app.chunk-load-reload-attempted';

    constructor(private logger: LoggerService, private windowService: AppWindowService) { }

    handleError(error: any) {
        const moduleLoadFailedMessage = /Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
        const errorMessage = error?.message || error?.toString() || '';
        const requiresExplicitRecovery = error?.code === 'account/settings-load-failed';

        if (!requiresExplicitRecovery && moduleLoadFailedMessage.test(errorMessage)) {
            try {
                // Persist the guard before navigating. Without usable session storage,
                // leave recovery to the user instead of risking a reload loop.
                const storage = this.windowService.windowRef.sessionStorage;
                if (storage && storage.getItem(this.chunkReloadGuardKey) !== '1') {
                    storage.setItem(this.chunkReloadGuardKey, '1');
                    this.windowService.windowRef.location.reload();
                }
            } catch { /* Storage/navigation failures must not replace the original error report. */ }
        }

        this.logger.error(error);
    }
}
