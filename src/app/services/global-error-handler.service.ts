import { ErrorHandler, Injectable } from '@angular/core';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';

@Injectable({
    providedIn: 'root'
})
export class GlobalErrorHandler implements ErrorHandler {
    constructor(private logger: LoggerService, private windowService: AppWindowService) { }

    handleError(error: any) {
        const chunkFailedMessage = /Loading chunk .* failed/;
        const dynamicImportFailedMessage = /Failed to fetch dynamically imported module/;
        const errorMessage = error?.message || error?.toString() || '';

        if (chunkFailedMessage.test(errorMessage) || dynamicImportFailedMessage.test(errorMessage)) {
            this.windowService.windowRef.location.reload();
        }

        this.logger.error(error);
    }
}
