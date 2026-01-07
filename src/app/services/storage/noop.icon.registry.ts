import { Injectable } from '@angular/core';
import { SafeResourceUrl } from '@angular/platform-browser';
import { Observable, of } from 'rxjs';

/**
 * A No-op icon registry for SSR.
 * Prevents MatIconRegistry from attempting to fetch SVG files via HTTP during prerendering/SSR.
 */
@Injectable()
export class NoopIconRegistry {
    addSvgIcon(): any { return this; }
    addSvgIconInNamespace(): any { return this; }
    addSvgIconLiteral(): any { return this; }
    addSvgIconLiteralInNamespace(): any { return this; }
    addSvgIconSet(): any { return this; }
    addSvgIconSetInNamespace(): any { return this; }
    addSvgIconSetLiteral(): any { return this; }
    addSvgIconSetLiteralInNamespace(): any { return this; }
    getNamedSvgIcon(): Observable<SVGElement> { return of(undefined as any); }
    getDefaultFontIconClass(): string { return ''; }
    setDefaultFontIconClass(): any { return this; }
}
