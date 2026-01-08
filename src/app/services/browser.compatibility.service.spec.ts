import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { BrowserUpgradeDialogComponent } from '../components/browser-upgrade-dialog/browser-upgrade-dialog.component';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('BrowserCompatibilityService', () => {
    let service: BrowserCompatibilityService;
    let dialog: MatDialog;

    const mockDialog = {
        open: vi.fn()
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [MatDialogModule],
            providers: [
                BrowserCompatibilityService,
                { provide: MatDialog, useValue: mockDialog }
            ]
        });
        service = TestBed.inject(BrowserCompatibilityService);
        dialog = TestBed.inject(MatDialog);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('checkCompressionSupport', () => {
        const originalCompressionStream = globalThis.CompressionStream;
        const originalDecompressionStream = globalThis.DecompressionStream;

        afterEach(() => {
            globalThis.CompressionStream = originalCompressionStream;
            globalThis.DecompressionStream = originalDecompressionStream;
        });

        it('should return true if both APIs are supported', () => {
            // @ts-ignore
            globalThis.CompressionStream = class { };
            // @ts-ignore
            globalThis.DecompressionStream = class { };

            const result = service.checkCompressionSupport(false);
            expect(result).toBe(true);
            expect(dialog.open).not.toHaveBeenCalled();
        });

        it('should return false and NOT open dialog if showDialog is false', () => {
            // @ts-ignore
            globalThis.CompressionStream = undefined;
            // @ts-ignore
            globalThis.DecompressionStream = undefined;

            const result = service.checkCompressionSupport(false);
            expect(result).toBe(false);
            expect(dialog.open).not.toHaveBeenCalled();
        });

        it('should return false and open dialog if APIs are missing and showDialog is true', () => {
            // @ts-ignore
            globalThis.CompressionStream = undefined;
            // @ts-ignore
            globalThis.DecompressionStream = undefined;

            const result = service.checkCompressionSupport(true);
            expect(result).toBe(false);
            expect(dialog.open).toHaveBeenCalledWith(BrowserUpgradeDialogComponent, expect.any(Object));
        });

        it('should return false if only one API is missing', () => {
            // @ts-ignore
            globalThis.CompressionStream = class { };
            // @ts-ignore
            globalThis.DecompressionStream = undefined;

            const result = service.checkCompressionSupport(false);
            expect(result).toBe(false);
        });
    });
});
