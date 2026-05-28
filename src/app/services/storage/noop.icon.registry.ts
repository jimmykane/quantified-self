import { DOCUMENT } from '@angular/common';
import { Inject, Injectable, Optional } from '@angular/core';
import { Observable, of } from 'rxjs';

/**
 * A No-op icon registry for SSR.
 * Prevents MatIconRegistry from attempting to fetch SVG files via HTTP during prerendering/SSR.
 * Use this only as a server-side MatIconRegistry provider override; browser rendering should keep
 * the real registry so registered SVG icons hydrate normally.
 */
@Injectable()
export class NoopIconRegistry {
    constructor(@Optional() @Inject(DOCUMENT) private readonly doc?: Document) { }

    addSvgIcon(): any { return this; }
    addSvgIconInNamespace(): any { return this; }
    addSvgIconLiteral(): any { return this; }
    addSvgIconLiteralInNamespace(): any { return this; }
    addSvgIconSet(): any { return this; }
    addSvgIconSetInNamespace(): any { return this; }
    addSvgIconSetLiteral(): any { return this; }
    addSvgIconSetLiteralInNamespace(): any { return this; }
    addSvgIconResolver(): any { return this; }
    registerFontClassAlias(): any { return this; }
    classNameForFontAlias(alias: string): string { return alias; }
    getDefaultFontIconClass(): string { return ''; }
    getDefaultFontSetClass(): string[] { return ['material-icons']; }
    getNamedSvgIcon(): Observable<SVGElement> { return of(this.createEmptySvg()); }
    getSvgIconFromUrl(): Observable<SVGElement> { return of(this.createEmptySvg()); }
    setDefaultFontIconClass(): any { return this; }
    setDefaultFontSetClass(): any { return this; }

    private createEmptySvg(): SVGElement {
        const doc = this.doc ?? (typeof document === 'undefined' ? undefined : document);
        const svg = doc?.createElementNS('http://www.w3.org/2000/svg', 'svg');

        if (!svg) {
            return undefined as any;
        }

        svg.setAttribute('focusable', 'false');
        return svg;
    }
}
