import { Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';
import { SharedModule } from '../../modules/shared.module';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppFileService } from '../../services/app.file.service';
import { AppRouteService } from '../../services/app.route.service';
import { LoggerService } from '../../services/logger.service';
import { UploadRoutesComponent } from '../upload/upload-routes/upload-routes.component';

@Component({
    selector: 'app-routes-page',
    standalone: true,
    imports: [SharedModule, UploadRoutesComponent],
    templateUrl: './routes-page.component.html',
    styleUrls: ['./routes-page.component.scss'],
})
export class RoutesPageComponent implements OnInit {
    private authService = inject(AppAuthService);
    private routeService = inject(AppRouteService);
    private dialog = inject(MatDialog);
    private snackBar = inject(MatSnackBar);
    private fileService = inject(AppFileService);
    private analyticsService = inject(AppAnalyticsService);
    private logger = inject(LoggerService);

    readonly user = signal<User | null>(null);
    readonly deletingRouteID = signal<string | null>(null);
    readonly downloadingRouteID = signal<string | null>(null);
    readonly routeCount = signal<number | null>(null);
    routes$: Observable<FirestoreRouteJSON[]> | null = null;

    async ngOnInit(): Promise<void> {
        const user = await this.authService.getUser();
        this.user.set(user);
        if (user) {
            this.routes$ = this.routeService.getRoutes(user);
            await this.refreshRouteCount();
        }
    }

    trackByRouteID(index: number, route: FirestoreRouteJSON): string {
        return `${route.id || index}`;
    }

    getRouteDate(route: FirestoreRouteJSON): Date | null {
        return this.toDate(route.createdAt) || this.toDate(route.importedAt);
    }

    getRouteActivityTypes(route: FirestoreRouteJSON): string {
        return route.activityTypes?.length ? route.activityTypes.join(', ') : 'Route';
    }

    getOriginalFilename(route: FirestoreRouteJSON): string {
        const file = this.routeService.getOriginalRouteFiles(route)[0];
        return file?.originalFilename || file?.path?.split('/').pop() || 'Original file';
    }

    async refreshRouteCount(): Promise<void> {
        const user = this.user();
        if (!user) {
            this.routeCount.set(null);
            return;
        }

        this.routeCount.set(await this.routeService.getRouteCount(user));
    }

    async confirmDeleteRoute(route: FirestoreRouteJSON): Promise<void> {
        const user = this.user();
        const routeID = route.id;
        if (!user || !routeID) {
            return;
        }

        const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
            data: {
                title: 'Delete route?',
                message: `Delete <strong>${route.name || 'this route'}</strong> and its original file?`,
                confirmText: 'Delete',
                confirmColor: 'warn',
            } as ConfirmationDialogData,
        });

        const confirmed = await firstValueFrom(dialogRef.afterClosed());
        if (!confirmed) {
            return;
        }

        this.deletingRouteID.set(routeID);
        try {
            await this.routeService.deleteRoute(user, routeID);
            await this.refreshRouteCount();
            this.snackBar.open('Route deleted.', undefined, { duration: 2500 });
        } catch (error) {
            this.logger.error('[RoutesPageComponent] Failed to delete route', { routeID }, error);
            this.snackBar.open('Failed to delete route.', undefined, { duration: 3000 });
        } finally {
            this.deletingRouteID.set(null);
        }
    }

    async downloadRouteOriginals(route: FirestoreRouteJSON): Promise<void> {
        const routeID = route.id;
        if (!routeID) {
            return;
        }

        const originalFiles = this.routeService.getOriginalRouteFiles(route);
        if (originalFiles.length === 0) {
            this.snackBar.open('No original route file found.', undefined, { duration: 3000 });
            return;
        }

        this.downloadingRouteID.set(routeID);
        this.snackBar.open('Preparing route download...', undefined, { duration: 2000 });
        try {
            const routeDate = this.getRouteDate(route);
            const baseName = this.sanitizeFilenameBase(route.name || routeID || 'route');

            if (originalFiles.length > 1) {
                const filesToZip: { data: ArrayBuffer; fileName: string }[] = [];
                for (let i = 0; i < originalFiles.length; i++) {
                    const fileMeta = originalFiles[i];
                    const extension = this.fileService.getExtensionFromPath(fileMeta.path, fileMeta.extension || 'gpx');
                    const fileDate = this.fileService.toDate(fileMeta.startDate) || routeDate;
                    const fileName = this.fileService.generateDateBasedFilename(fileDate, extension, i + 1, originalFiles.length, baseName);
                    filesToZip.push({
                        data: await this.routeService.downloadFile(fileMeta.path),
                        fileName,
                    });
                }

                await this.fileService.downloadAsZip(filesToZip, `${baseName}_originals.zip`);
                this.analyticsService.logEvent('downloaded_route_original_files_zip');
                return;
            }

            const fileMeta = originalFiles[0];
            const extension = this.fileService.getExtensionFromPath(fileMeta.path, fileMeta.extension || 'gpx');
            const buffer = await this.routeService.downloadFile(fileMeta.path);
            this.fileService.downloadFile(new Blob([buffer]), baseName, extension);
            this.analyticsService.logEvent('downloaded_route_original_file');
        } catch (error) {
            this.logger.error('[RoutesPageComponent] Failed to download route original file', { routeID }, error);
            this.snackBar.open('Failed to download route file.', undefined, { duration: 3000 });
        } finally {
            this.downloadingRouteID.set(null);
        }
    }

    private toDate(rawDate: unknown): Date | null {
        if (!rawDate) return null;
        if (rawDate instanceof Date) return rawDate;
        if (typeof (rawDate as { toDate?: unknown }).toDate === 'function') {
            return (rawDate as { toDate: () => Date }).toDate();
        }
        if (
            typeof (rawDate as { seconds?: unknown }).seconds === 'number'
            && typeof (rawDate as { nanoseconds?: unknown }).nanoseconds === 'number'
        ) {
            const timestamp = rawDate as { seconds: number; nanoseconds: number };
            return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000);
        }
        if (typeof rawDate === 'number') return new Date(rawDate);
        if (typeof rawDate === 'string') {
            const date = new Date(rawDate);
            return Number.isNaN(date.getTime()) ? null : date;
        }
        return null;
    }

    private sanitizeFilenameBase(value: string): string {
        const sanitized = value
            .trim()
            .replace(/[\\/:*?"<>|]+/g, '-')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^[-_.]+|[-_.]+$/g, '');
        return sanitized || 'route';
    }
}
