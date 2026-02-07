import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@Injectable({
    providedIn: 'root'
})
export class NetworkAwarePreloadingStrategy implements PreloadingStrategy {
    preload(route: Route, load: () => Observable<any>): Observable<any> {
        const shouldPreload = route.data?.['preload'] === true;
        if (!shouldPreload) {
            return of(null);
        }
        if (!this.hasGoodConnection()) {
            return of(null);
        }
        return timer(5000).pipe(switchMap(() => load()));
    }

    private hasGoodConnection(): boolean {
        const conn = (navigator as any).connection;
        if (conn) {
            if (conn.saveData) {
                return false;
            }
            const effectiveType = conn.effectiveType || '';
            if (effectiveType.includes('2g')) {
                return false;
            }
        }
        return true;
    }
}
