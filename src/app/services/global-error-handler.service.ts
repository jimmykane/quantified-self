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
        const chunkFailedMessage = /Loading chunk .* failed/;
        const dynamicImportFailedMessage = /Failed to fetch dynamically imported module/;
        const errorMessage = error?.message || error?.toString() || '';

        if (chunkFailedMessage.test(errorMessage) || dynamicImportFailedMessage.test(errorMessage)) {
            const hasReloadedForChunkError = this.windowService.windowRef.sessionStorage?.getItem(this.chunkReloadGuardKey) === '1';
            if (!hasReloadedForChunkError) {
                this.windowService.windowRef.sessionStorage?.setItem(this.chunkReloadGuardKey, '1');
                this.windowService.windowRef.location.reload();
            }
        }

        this.logger.error(error);
    }
}
