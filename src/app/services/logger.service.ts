import { ErrorHandler, Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

import * as Sentry from '@sentry/browser';

@Injectable({
    providedIn: 'root'
})
export class LoggerService {

    constructor() { }

    log(message: any, ...optionalParams: any[]) {
        if (!environment.production || environment.beta) {
            console.log(message, ...optionalParams);
        }
    }

    info(message: any, ...optionalParams: any[]) {
        if (!environment.production || environment.beta) {
            console.info(message, ...optionalParams);
        }
    }

    warn(message: any, ...optionalParams: any[]) {
        console.warn(message, ...optionalParams);
    }

    error(message: any, ...optionalParams: any[]) {
        console.error(message, ...optionalParams);
        const error = [message, ...optionalParams].find(arg => arg instanceof Error);
        if (error) {
            Sentry.captureException(error);
        }
    }

    captureException(error: any, context?: any) {
        Sentry.captureException(error, context);
    }

    captureMessage(message: string, context?: any) {
        Sentry.captureMessage(message, context);
    }

    setUser(user: { id?: string; email?: string; username?: string; ip_address?: string } | null) {
        Sentry.setUser(user);
    }

    setTag(key: string, value: string) {
        Sentry.setTag(key, value);
    }
}

@Injectable({
    providedIn: 'root'
})
export class GlobalErrorHandler implements ErrorHandler {
    constructor(private logger: LoggerService) { }
    handleError(error: any) {
        this.logger.error(error);
    }
}
