import { TestBed } from '@angular/core/testing';
import { AppIconService } from './app.icon.service';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('AppIconService', () => {
    let service: AppIconService;
    let matIconRegistrySpy: { addSvgIcon: any };
    let domSanitizerSpy: { bypassSecurityTrustResourceUrl: any };

    beforeEach(() => {
        matIconRegistrySpy = { addSvgIcon: vi.fn() };
        domSanitizerSpy = { bypassSecurityTrustResourceUrl: vi.fn() };

        TestBed.configureTestingModule({
            providers: [
                AppIconService,
                { provide: MatIconRegistry, useValue: matIconRegistrySpy },
                { provide: DomSanitizer, useValue: domSanitizerSpy }
            ]
        });
        service = TestBed.inject(AppIconService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should register icons', () => {
        service.registerIcons();
        // Check that addSvgIcon was called multiple times (at least once for each icon in the list)
        expect(matIconRegistrySpy.addSvgIcon).toHaveBeenCalled();
        // We can be more specific if we want, checking for a specific icon
        expect(matIconRegistrySpy.addSvgIcon).toHaveBeenCalledWith('logo', undefined);
    });
});
