import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, BehaviorSubject, combineLatest, distinctUntilChanged, map, Observable, shareReplay, switchMap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Sort, SortDirection } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
    ActivityTypes,
    ActivityTypesHelper,
    DataAscent,
    DataDescent,
    DataDistance,
    DataGradeMax,
    DataGradeMin,
    ServiceNames,
} from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { ProviderPresentation } from '@shared/provider-presentation';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { buildSuuntoServiceConnectionViewModel, SuuntoServiceConnectionViewModel } from '../../helpers/suunto-service-connection.helper';
import {
    DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID,
    DashboardActionPromptEvent,
    DashboardActionPromptViewModel,
    isDashboardActionPromptDismissed,
    markDashboardActionPromptDismissed,
} from '../../helpers/dashboard-action-prompt.helper';
import {
    buildSuuntoRouteCatchUpPromptViewModel,
    buildSuuntoRouteCatchUpSnackbarMessage,
} from '../../helpers/suunto-route-catch-up.helper';
import {
    canSendRouteToConnectedGarminAccount,
    canSendRouteToConnectedSuuntoAccounts,
    getGarminRouteSendMenuLabel,
    getGarminRouteSendDisabledReason,
    getRouteServiceDisplayName,
    getRouteSourceSummary,
    getRouteSyncedDestinationSummaries,
} from '../../helpers/route-provenance.helper';
import {
    beginTableRowPointerTracking,
    cancelTableRowPointerTracking,
    createTableRowActivationState,
    endTableRowPointerTracking,
    shouldActivateTableRowFromClick,
    shouldActivateTableRowFromKeyboard,
    TableRowActivationState,
    updateTableRowPointerTracking,
} from '../../helpers/table-row-activation.helper';
import { SHOW_GARMIN_ROUTE_SEND } from '../../constants/route-delivery.constants';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';
import { SharedModule } from '../../modules/shared.module';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppFileService } from '../../services/app.file.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppOriginalFileDownloadService } from '../../services/app.original-file-download.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { AppRouteGPXExportService } from '../../services/app.route-gpx-export.service';
import {
    AppRouteReprocessService,
    getRouteReprocessErrorMessage,
    getRouteReprocessProgressTitle,
    RouteReprocessProgress,
} from '../../services/app.route-reprocess.service';
import {
    getActionableRouteSendResponseMessage,
    AppRouteSendService,
    getRouteSendErrorMessage,
    getRouteSendResponseMessage,
} from '../../services/app.route-send.service';
import {
    AppRouteService,
    isRouteListServerSortColumn,
    ROUTE_LIST_DEFAULT_SORT,
    RouteListSort,
} from '../../services/app.route.service';
import { AppUserService, GarminRouteSendContext } from '../../services/app.user.service';
import { LoggerService } from '../../services/logger.service';
import { AppWindowService } from '../../services/app.window.service';
import { UploadRoutesComponent } from '../upload/upload-routes/upload-routes.component';
import { AppAppSettingsInterface, AppUserInterface } from '../../models/app-user.interface';

interface RoutePageRouteViewModel {
    route: FirestoreRouteJSON;
    name: string;
    routeDate: Date | null;
    routeDateSortMs: number | null;
    sourcePresentation: ProviderPresentation | null;
    sourceServiceLabel: string;
    sourceServiceTitle: string;
    sourceServiceName: ServiceNames | null;
    activityTypes: string;
    activityTypeSummaries: RouteActivityTypeSummary[];
    activityTypesTitle: string;
    activityTypeFilterValues: string[];
    fileType: string;
    fileTypeFilterValue: string;
    originalFilename: string;
    routeCountLabel: string;
    pointCountLabel: string;
    waypointCountLabel: string | null;
    provenanceSummary: string;
    provenanceTitle: string;
    provenanceItems: RouteProvenanceItem[];
    distance: RouteMetricCell;
    ascent: RouteMetricCell;
    descent: RouteMetricCell;
    minGrade: RouteMetricCell;
    maxGrade: RouteMetricCell;
    canReprocess: boolean;
    canExportGPX: boolean;
    canDownloadOriginals: boolean;
    canSendToSuunto: boolean;
    canSendToGarmin: boolean;
    garminSendDisabledReason: string | null;
    garminSendMenuLabel: string;
    canDelete: boolean;
    filterText: string;
}

interface RouteMetricCell {
    label: string;
    sortValue: number | null;
    title: string;
}

interface RouteProvenanceItem {
    id: string;
    label: string;
    title: string;
    serviceName: ServiceNames | null;
}

interface RouteActivityTypeSummary {
    id: string;
    activityTypeLabel: string;
    activityTypeIconValue: string;
}

type RouteSortColumn =
    | 'date'
    | 'name'
    | 'sourceService'
    | 'activityTypes'
    | 'distance'
    | 'ascent'
    | 'descent'
    | 'minGrade'
    | 'maxGrade'
    | 'pointCount'
    | 'originalFilename';

interface RouteSortState {
    active: RouteSortColumn;
    direction: SortDirection;
}

interface RouteFilterState {
    text: string;
    fileType: string;
    activityType: string;
}

interface RouteFilterOption {
    value: string;
    label: string;
}

@Component({
    selector: 'app-routes-page',
    standalone: true,
    imports: [SharedModule, UploadRoutesComponent],
    templateUrl: './routes-page.component.html',
    styleUrls: ['./routes-page.component.scss'],
})
export class RoutesPageComponent implements OnInit {
    private destroyRef = inject(DestroyRef);
    private authService = inject(AppAuthService);
    private userService = inject(AppUserService);
    private routeService = inject(AppRouteService);
    private dialog = inject(MatDialog);
    private snackBar = inject(MatSnackBar);
    private fileService = inject(AppFileService);
    private analyticsService = inject(AppAnalyticsService);
    private hapticsService = inject(AppHapticsService);
    private originalFileDownloadService = inject(AppOriginalFileDownloadService);
    private processingService = inject(AppProcessingService);
    private routeGPXExportService = inject(AppRouteGPXExportService);
    private routeReprocessService = inject(AppRouteReprocessService);
    private routeSendService = inject(AppRouteSendService);
    private logger = inject(LoggerService);
    private router = inject(Router);
    private windowService = inject(AppWindowService);
    private readonly routeSortSubject = new BehaviorSubject<RouteSortState>({
        active: 'date',
        direction: 'desc',
    });
    private readonly routeFilterSubject = new BehaviorSubject<RouteFilterState>({
        text: '',
        fileType: '',
        activityType: '',
    });
    private readonly connectedSuuntoProviderUserIdsSubject = new BehaviorSubject<string[]>([]);
    private readonly garminRouteSendContextSubject = new BehaviorSubject<GarminRouteSendContext>({
        connected: false,
        reconnectRequired: false,
        missingPermissions: [],
        providerUserId: null,
        providerStates: [],
        serviceMeta: null,
    });
    private readonly loadedRouteViewModels = signal<RoutePageRouteViewModel[]>([]);
    private readonly visibleRouteViewModels = signal<RoutePageRouteViewModel[]>([]);
    private readonly routeRowActivationState: TableRowActivationState = createTableRowActivationState();

    readonly user = signal<AppUserInterface | null>(null);
    readonly deletingRouteID = signal<string | null>(null);
    readonly downloadingRouteID = signal<string | null>(null);
    readonly exportingRouteID = signal<string | null>(null);
    readonly sendingToServiceRouteID = signal<string | null>(null);
    readonly bulkActionInProgress = signal(false);
    readonly reprocessingRouteID = signal<string | null>(null);
    readonly routeCount = signal<number | null>(null);
    readonly loadedRouteCount = signal(0);
    readonly filteredRouteCount = signal(0);
    readonly routeFilter = signal('');
    readonly routeFileTypeFilter = signal('');
    readonly routeActivityTypeFilter = signal('');
    readonly routeFileTypeFilterOptions = signal<RouteFilterOption[]>([]);
    readonly routeActivityTypeFilterOptions = signal<RouteFilterOption[]>([]);
    readonly routeSortActive = signal<RouteSortColumn>('date');
    readonly routeSortDirection = signal<SortDirection>('desc');
    readonly selectedRouteIDs = signal<string[]>([]);
    readonly didLastSuuntoRouteCatchUp = signal<Date | null>(null);
    readonly suuntoRouteCatchUpPromptSource = signal<string | null>(null);
    readonly isQueueingSuuntoRouteCatchUpPrompt = signal(false);
    readonly isReconnectingSuuntoRouteCatchUpPrompt = signal(false);
    readonly isDismissingSuuntoRouteCatchUpPrompt = signal(false);
    readonly suuntoRouteCatchUpPromptError = signal<string | null>(null);
    readonly connectedSuuntoProviderUserIds = signal<string[]>([]);
    readonly garminRouteSendContext = signal<GarminRouteSendContext>({
        connected: false,
        reconnectRequired: false,
        missingPermissions: [],
        providerUserId: null,
        providerStates: [],
        serviceMeta: null,
    });
    readonly suuntoConnectionView = signal<SuuntoServiceConnectionViewModel>(buildSuuntoServiceConnectionViewModel({
        hasToken: false,
        serviceMeta: null,
    }));
    readonly canSendRoutesToSuunto = computed(() => {
        const connectionView = this.suuntoConnectionView();
        return this.userService.hasProAccessSignal()
            && connectionView.connected
            && !connectionView.reconnectRequired;
    });
    readonly canSendRoutesToGarmin = computed(() => {
        const connectionView = this.garminRouteSendContext();
        return this.userService.hasProAccessSignal()
            && connectionView.connected
            && !connectionView.reconnectRequired
            && connectionView.missingPermissions.length === 0;
    });
    readonly showGarminRouteSend = SHOW_GARMIN_ROUTE_SEND;
    readonly routeFilterActive = computed(() => this.isRouteFilterActive());
    readonly selectedRouteCount = computed(() => this.selectedRouteIDs().length);
    readonly selectedRouteIDSet = computed(() => new Set(this.selectedRouteIDs()));
    readonly suuntoRouteCatchUpPrompt = computed<DashboardActionPromptViewModel | null>(() => {
        const user = this.user();
        const connectionView = this.suuntoConnectionView();
        const promptSource = this.suuntoRouteCatchUpPromptSource();

        if (
            !user
            || this.didLastSuuntoRouteCatchUp() !== null
            || (!connectionView.connected && !connectionView.reconnectRequired)
            || !promptSource
            || isDashboardActionPromptDismissed(
                user.settings?.appSettings,
                DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID,
                promptSource,
            )
        ) {
            return null;
        }

        return buildSuuntoRouteCatchUpPromptViewModel({
            variant: !this.userService.hasProAccessSignal()
                ? 'upgrade'
                : connectionView.reconnectRequired
                    ? 'reconnect'
                    : 'queue',
            busy: this.isQueueingSuuntoRouteCatchUpPrompt()
                || this.isReconnectingSuuntoRouteCatchUpPrompt()
                || this.isDismissingSuuntoRouteCatchUpPrompt(),
            error: this.suuntoRouteCatchUpPromptError(),
        });
    });
    readonly selectedSendableRouteCount = computed(() => {
        const selectedIDs = this.selectedRouteIDSet();
        return this.visibleRouteViewModels().filter(item => (
            !!item.route.id
            && selectedIDs.has(item.route.id)
            && item.canSendToSuunto
        )).length;
    });
    readonly selectedSendableRoutesToGarminCount = computed(() => {
        const selectedIDs = this.selectedRouteIDSet();
        return this.visibleRouteViewModels().filter(item => (
            !!item.route.id
            && selectedIDs.has(item.route.id)
            && item.canSendToGarmin
        )).length;
    });
    readonly allVisibleRoutesSelected = computed(() => {
        const visibleRoutes = this.visibleRouteViewModels();
        const selectedIDs = this.selectedRouteIDSet();
        return visibleRoutes.length > 0
            && visibleRoutes.every(item => !!item.route.id && selectedIDs.has(item.route.id));
    });
    readonly visibleRouteSelectionIndeterminate = computed(() => (
        this.selectedRouteCount() > 0 && !this.allVisibleRoutesSelected()
    ));
    readonly routeResultSummary = computed(() => {
        const total = Math.max(this.routeCount() ?? 0, this.loadedRouteCount());
        const loaded = this.loadedRouteCount();
        const filtered = this.filteredRouteCount();
        if (loaded === 0 && total === 0) {
            return 'No routes';
        }
        if (this.isRouteFilterActive()) {
            return `${filtered} of ${loaded} loaded route${loaded === 1 ? '' : 's'}`;
        }
        if (loaded >= total) {
            return `${total} route${total === 1 ? '' : 's'}`;
        }
        const sortActive = this.routeSortActive() !== 'date' || this.routeSortDirection() !== 'desc';
        const clientOnlySortActive = sortActive && !isRouteListServerSortColumn(this.routeSortActive());
        return `${loaded} of ${total} loaded${clientOnlySortActive ? '; sorting loaded rows' : ''}`;
    });
    readonly routeColumns = [
        'select',
        'date',
        'name',
        'sourceService',
        'activityTypes',
        'distance',
        'ascent',
        'descent',
        'minGrade',
        'maxGrade',
        'pointCount',
        'originalFilename',
        'actions',
    ];
    readonly routeHeaderDataTypes = {
        distance: DataDistance.type,
        ascent: DataAscent.type,
        descent: DataDescent.type,
        minGrade: DataGradeMin.type,
        maxGrade: DataGradeMax.type,
    };
    routes$: Observable<RoutePageRouteViewModel[]> | null = null;
    readonly routeSelection = new SelectionModel<string>(true, []);

    async ngOnInit(): Promise<void> {
        const user = await this.authService.getUser() as AppUserInterface | null;
        this.user.set(user);
        if (user) {
            this.userService.watchSuuntoRouteCatchUpPromptContext(user).pipe(
                takeUntilDestroyed(this.destroyRef),
            ).subscribe(context => {
                this.suuntoConnectionView.set(context.connectionView);
                this.didLastSuuntoRouteCatchUp.set(context.didLastRouteImport);
                this.suuntoRouteCatchUpPromptSource.set(context.promptSource);
                this.connectedSuuntoProviderUserIds.set(context.connectedProviderUserIds);
                this.connectedSuuntoProviderUserIdsSubject.next(context.connectedProviderUserIds);
            });
            this.userService.watchGarminRouteSendContext(user).pipe(
                takeUntilDestroyed(this.destroyRef),
            ).subscribe(context => {
                this.garminRouteSendContext.set(context);
                this.garminRouteSendContextSubject.next(context);
            });

            const routeDocuments$ = this.routeSortSubject.pipe(
                map(routeSort => this.toRouteListSort(routeSort)),
                distinctUntilChanged((first, second) => (
                    first.active === second.active
                    && first.direction === second.direction
                )),
                switchMap(routeSort => this.routeService.getRoutes(user, 50, routeSort)),
                shareReplay({ bufferSize: 1, refCount: true }),
            );
            this.routes$ = combineLatest([
                routeDocuments$,
                this.routeSortSubject,
                this.routeFilterSubject,
                this.connectedSuuntoProviderUserIdsSubject,
                this.garminRouteSendContextSubject,
            ]).pipe(
                map(([routes, routeSort, routeFilter]) => {
                    const routeViewModels = routes.map(route => this.toRouteViewModel(route));
                    this.loadedRouteViewModels.set(routeViewModels);
                    this.loadedRouteCount.set(routeViewModels.length);
                    this.routeFileTypeFilterOptions.set(this.buildRouteFileTypeFilterOptions(routeViewModels));
                    this.routeActivityTypeFilterOptions.set(this.buildRouteActivityTypeFilterOptions(routeViewModels));
                    const filteredRouteViewModels = this.filterRouteViewModels(routeViewModels, routeFilter);
                    this.filteredRouteCount.set(filteredRouteViewModels.length);
                    this.reconcileSelectionWithVisibleRoutes(filteredRouteViewModels);
                    const sortedRouteViewModels = this.sortRouteViewModels(filteredRouteViewModels, routeSort);
                    this.visibleRouteViewModels.set(sortedRouteViewModels);
                    return sortedRouteViewModels;
                }),
            );
            const routeCount = await this.refreshRouteCount();
            this.analyticsService.logSavedRouteAction('view', { routeCount });
        }
    }

    trackByRouteID(index: number, item: RoutePageRouteViewModel): string {
        return `${item.route.id || index}`;
    }

    toggleRouteSelection(item: RoutePageRouteViewModel, checked: boolean): void {
        const routeID = item.route.id;
        if (!routeID) {
            return;
        }
        if (checked) {
            this.routeSelection.select(routeID);
        } else {
            this.routeSelection.deselect(routeID);
        }
        this.syncSelectedRouteIDs();
        this.hapticsService.selection();
    }

    toggleVisibleRouteSelection(checked: boolean): void {
        if (checked) {
            const visibleRouteIDs = this.visibleRouteViewModels()
                .map(item => item.route.id)
                .filter((routeID): routeID is string => !!routeID);
            this.routeSelection.select(...visibleRouteIDs);
        } else {
            this.routeSelection.clear();
        }
        this.syncSelectedRouteIDs();
        this.hapticsService.selection();
    }

    clearRouteSelection(event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();
        this.routeSelection.clear();
        this.syncSelectedRouteIDs();
        this.hapticsService.selection();
    }

    onRouteSortChange(sort: Sort): void {
        const active = this.isRouteSortColumn(sort.active) ? sort.active : 'date';
        const direction = sort.direction || (active === 'date' ? 'desc' : 'asc');
        this.routeSortActive.set(active);
        this.routeSortDirection.set(direction);
        this.routeSortSubject.next({ active, direction });
        this.hapticsService.selection();
        this.analyticsService.logSavedRouteAction('sort', {
            sortColumn: active,
            sortDirection: direction === 'desc' ? 'desc' : 'asc',
            filterActive: this.isRouteFilterActive(),
            resultCount: this.filteredRouteCount(),
        });
    }

    updateRouteFilter(value: string): void {
        const wasFilterActive = this.isRouteFilterActive();
        this.routeFilter.set(value);
        this.emitRouteFilterState();
        if (this.isRouteFilterActive() !== wasFilterActive) {
            this.hapticsService.selection();
            this.analyticsService.logSavedRouteAction('filter', {
                status: this.isRouteFilterActive() ? 'applied' : 'cleared',
                filterActive: this.isRouteFilterActive(),
                resultCount: this.filteredRouteCount(),
            });
        }
    }

    updateRouteFileTypeFilter(value: string): void {
        if (this.routeFileTypeFilter() === value) {
            return;
        }
        this.routeFileTypeFilter.set(value);
        this.applyRouteFacetFilterChange();
    }

    updateRouteActivityTypeFilter(value: string): void {
        if (this.routeActivityTypeFilter() === value) {
            return;
        }
        this.routeActivityTypeFilter.set(value);
        this.applyRouteFacetFilterChange();
    }

    async refreshRouteCount(): Promise<number | null> {
        const user = this.user();
        if (!user) {
            this.routeCount.set(null);
            return null;
        }

        const count = await this.routeService.getRouteCount(user);
        this.routeCount.set(count);
        return count;
    }

    onSuuntoRouteCatchUpPromptPrimary(event: DashboardActionPromptEvent): void {
        switch (event.action.id) {
            case 'queueSuuntoRouteCatchUp':
                void this.queueSuuntoRouteCatchUpPrompt();
                return;
            case 'reconnectSuuntoService':
                void this.reconnectSuuntoRouteCatchUpPrompt();
                return;
            case 'upgradeToPro':
                void this.openSubscriptions();
                return;
        }
    }

    onSuuntoRouteCatchUpPromptSecondary(event: DashboardActionPromptEvent): void {
        if (event.action.id === 'dismissSuuntoRouteCatchUp') {
            void this.dismissSuuntoRouteCatchUpPrompt();
        }
    }

    async queueSuuntoRouteCatchUpPrompt(): Promise<void> {
        if (
            this.suuntoRouteCatchUpPrompt() === null
            || this.isQueueingSuuntoRouteCatchUpPrompt()
            || this.isReconnectingSuuntoRouteCatchUpPrompt()
            || this.isDismissingSuuntoRouteCatchUpPrompt()
        ) {
            return;
        }

        this.isQueueingSuuntoRouteCatchUpPrompt.set(true);
        this.suuntoRouteCatchUpPromptError.set(null);

        try {
            const summary = await this.userService.addSuuntoRoutesToQueueForCurrentUser();
            const feedback = buildSuuntoRouteCatchUpSnackbarMessage(summary);
            if ((summary.failedProviderCount || 0) === 0 && summary.failureCount === 0) {
                this.didLastSuuntoRouteCatchUp.set(new Date());
            }
            this.snackBar.open(feedback.message, undefined, { duration: feedback.duration });
        } catch (error: any) {
            this.suuntoRouteCatchUpPromptError.set('Could not queue Suunto routes.');
            this.logger.error('[RoutesPageComponent] Failed to queue Suunto route catch-up prompt', error);
            this.snackBar.open(`Could not queue Suunto routes: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
        } finally {
            this.isQueueingSuuntoRouteCatchUpPrompt.set(false);
        }
    }

    async reconnectSuuntoRouteCatchUpPrompt(): Promise<void> {
        if (
            this.suuntoRouteCatchUpPrompt() === null
            || this.isQueueingSuuntoRouteCatchUpPrompt()
            || this.isReconnectingSuuntoRouteCatchUpPrompt()
            || this.isDismissingSuuntoRouteCatchUpPrompt()
        ) {
            return;
        }

        this.isReconnectingSuuntoRouteCatchUpPrompt.set(true);
        this.suuntoRouteCatchUpPromptError.set(null);

        try {
            const tokenAndURI = await this.userService.getCurrentUserServiceTokenAndRedirectURI(ServiceNames.SuuntoApp);
            this.windowService.windowRef.location.href = tokenAndURI.redirect_uri;
        } catch (error) {
            this.suuntoRouteCatchUpPromptError.set('Could not start Suunto reconnect.');
            this.logger.error('[RoutesPageComponent] Failed to start Suunto reconnect from route catch-up prompt', error);
            this.isReconnectingSuuntoRouteCatchUpPrompt.set(false);
        }
    }

    async dismissSuuntoRouteCatchUpPrompt(): Promise<void> {
        const user = this.user();
        const promptSource = this.suuntoRouteCatchUpPromptSource();
        if (
            !user
            || !promptSource
            || this.suuntoRouteCatchUpPrompt() === null
            || this.isQueueingSuuntoRouteCatchUpPrompt()
            || this.isReconnectingSuuntoRouteCatchUpPrompt()
            || this.isDismissingSuuntoRouteCatchUpPrompt()
        ) {
            return;
        }

        this.isDismissingSuuntoRouteCatchUpPrompt.set(true);
        this.suuntoRouteCatchUpPromptError.set(null);

        try {
            user.settings = user.settings || {} as any;
            const nextAppSettings = {
                ...(user.settings.appSettings || {}),
            } as AppAppSettingsInterface;
            const dismissedState = markDashboardActionPromptDismissed(
                nextAppSettings,
                DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID,
                promptSource,
                Date.now(),
            );

            await this.userService.updateUserProperties(user, {
                settings: {
                    appSettings: {
                        dashboardActionPrompts: {
                            [DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID]: dismissedState,
                        },
                    },
                },
            });
            user.settings.appSettings = nextAppSettings;
            this.user.set(Object.assign(
                Object.create(Object.getPrototypeOf(user)),
                user,
            ) as AppUserInterface);
            this.analyticsService.logEvent('dashboard_action_prompt_dismiss', {
                prompt_id: DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID,
            });
        } catch (error) {
            this.suuntoRouteCatchUpPromptError.set('Could not save this choice.');
            this.logger.error('[RoutesPageComponent] Failed to dismiss Suunto route catch-up prompt', error);
        } finally {
            this.isDismissingSuuntoRouteCatchUpPrompt.set(false);
        }
    }

    openRouteDetails(item: RoutePageRouteViewModel): void {
        const routeID = item.route.id;
        const userID = item.route.userID || this.user()?.uid;
        if (!routeID || !userID) {
            return;
        }

        this.analyticsService.logSavedRouteAction('open_details', {
            fileType: this.getPrimaryRouteFileType(item.route),
        });
        void this.router.navigate(['/user', userID, 'route', routeID]);
    }

    onRouteRowPointerDown(event: PointerEvent): void {
        beginTableRowPointerTracking(this.routeRowActivationState, event);
    }

    onRouteRowPointerMove(event: PointerEvent): void {
        updateTableRowPointerTracking(this.routeRowActivationState, event);
    }

    onRouteRowPointerUp(event: PointerEvent): void {
        endTableRowPointerTracking(this.routeRowActivationState, event);
    }

    onRouteRowPointerCancel(event: PointerEvent): void {
        cancelTableRowPointerTracking(this.routeRowActivationState, event);
    }

    onRouteRowClick(item: RoutePageRouteViewModel, event: MouseEvent): void {
        if (!shouldActivateTableRowFromClick(this.routeRowActivationState, event)) {
            return;
        }

        this.openRouteDetails(item);
    }

    onRouteRowKeydown(item: RoutePageRouteViewModel, event: KeyboardEvent): void {
        if (!shouldActivateTableRowFromKeyboard(event)) {
            return;
        }

        if (event.key === ' ') {
            event.preventDefault();
        }
        this.openRouteDetails(item);
    }

    async confirmDeleteRoute(route: FirestoreRouteJSON): Promise<void> {
        const user = this.user();
        const routeID = route.id;
        if (
            !user
            || !routeID
            || this.deletingRouteID() === routeID
            || this.bulkActionInProgress()
            || this.exportingRouteID() === routeID
            || this.downloadingRouteID() === routeID
            || this.reprocessingRouteID() === routeID
            || this.sendingToServiceRouteID() === routeID
            || !this.canManageRoute(route)
        ) {
            return;
        }

        const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
            data: {
                title: 'Delete route?',
                message: `Delete ${route.name || 'this route'} and its original file?`,
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
            const routeCount = await this.refreshRouteCount();
            this.analyticsService.logSavedRouteAction('delete', {
                status: 'success',
                routeCount,
                fileType: this.getPrimaryRouteFileType(route),
            });
            this.snackBar.open('Route deleted.', undefined, { duration: 2500 });
        } catch (error) {
            this.analyticsService.logSavedRouteAction('delete', {
                status: 'failure',
                fileType: this.getPrimaryRouteFileType(route),
            });
            this.logger.error('[RoutesPageComponent] Failed to delete route', { routeID }, error);
            this.snackBar.open('Failed to delete route.', undefined, { duration: 3000 });
        } finally {
            this.deletingRouteID.set(null);
        }
    }

    async downloadRouteOriginals(route: FirestoreRouteJSON): Promise<void> {
        const routeID = route.id;
        if (
            !routeID
            || this.bulkActionInProgress()
            || this.downloadingRouteID() === routeID
            || this.exportingRouteID() === routeID
            || this.deletingRouteID() === routeID
            || this.reprocessingRouteID() === routeID
            || this.sendingToServiceRouteID() === routeID
            || !this.canManageRoute(route)
        ) {
            return;
        }

        const originalFiles = this.routeService.getOriginalRouteFiles(route);
        if (originalFiles.length === 0) {
            this.analyticsService.logSavedRouteAction('download', {
                status: 'missing_file',
                fileCount: 0,
            });
            this.snackBar.open('No original route file found.', undefined, { duration: 3000 });
            return;
        }

        this.downloadingRouteID.set(routeID);
        this.snackBar.open('Preparing route download...', undefined, { duration: 2000 });
        try {
            const result = await this.originalFileDownloadService.downloadOriginalFiles({
                sources: originalFiles.map(file => ({
                    ...file,
                    fallbackDate: this.resolveRouteDate(route),
                })),
                downloadFile: (path) => this.routeService.downloadOriginalFile(path),
                zipSuffix: 'route_originals',
                fallbackFileName: 'original-route-file',
            });
            this.analyticsService.logSavedRouteAction('download', {
                status: 'success',
                fileCount: result.downloadedCount,
                fileType: this.getPrimaryRouteFileType(route),
                zipped: result.mode === 'zip',
            });
        } catch (error) {
            this.analyticsService.logSavedRouteAction('download', {
                status: 'failure',
                fileCount: originalFiles.length,
                fileType: this.getPrimaryRouteFileType(route),
                zipped: originalFiles.length > 1,
            });
            this.logger.error('[RoutesPageComponent] Failed to download route original file', { routeID }, error);
            this.snackBar.open('Failed to download route file.', undefined, { duration: 3000 });
        } finally {
            this.downloadingRouteID.set(null);
        }
    }

    async exportRouteAsGPX(route: FirestoreRouteJSON, source: 'routes_list_row' | 'routes_list_bulk' = 'routes_list_row'): Promise<void> {
        const routeID = route.id;
        if (
            !routeID
            || this.exportingRouteID() !== null
            || this.bulkActionInProgress()
            || this.deletingRouteID() === routeID
            || this.downloadingRouteID() === routeID
            || this.reprocessingRouteID() === routeID
            || this.sendingToServiceRouteID() === routeID
            || !this.canManageRoute(route)
        ) {
            return;
        }

        const originalFiles = this.routeService.getOriginalRouteFiles(route);
        if (originalFiles.length === 0) {
            this.analyticsService.logSavedRouteAction('export_gpx', {
                status: 'missing_file',
                fileCount: 0,
                fileType: this.getPrimaryRouteFileType(route),
                source,
            });
            this.snackBar.open('No original route file found.', undefined, { duration: 3000 });
            return;
        }

        this.exportingRouteID.set(routeID);
        this.snackBar.open('Generating route GPX...', undefined, { duration: 2000 });
        try {
            const result = await this.routeGPXExportService.getRouteDocumentAsGPXBlob(route);
            const baseName = this.sanitizeFilenameBase(result.hydratedRoute.routeDocument.name || route.name || routeID || 'route');
            this.fileService.downloadFile(result.blob, baseName, 'gpx');
            this.analyticsService.logSavedRouteAction('export_gpx', {
                status: 'success',
                fileCount: 1,
                fileType: 'gpx',
                zipped: false,
                source,
            });
            this.snackBar.open('GPX file served.', undefined, { duration: 2000 });
        } catch (error) {
            this.analyticsService.logSavedRouteAction('export_gpx', {
                status: 'failure',
                fileCount: 0,
                fileType: this.getPrimaryRouteFileType(route),
                zipped: false,
                source,
            });
            this.logger.error('[RoutesPageComponent] Failed to export route GPX', { routeID }, error);
            this.snackBar.open('Could not export route GPX.', undefined, { duration: 3000 });
        } finally {
            this.exportingRouteID.set(null);
        }
    }

    getRouteSendDestinationLabel(destinationServiceName: ServiceNames): string {
        return getRouteServiceDisplayName(destinationServiceName);
    }

    async sendRouteToSuunto(route: FirestoreRouteJSON, source: 'routes_list_row' | 'routes_list_bulk' = 'routes_list_row'): Promise<void> {
        await this.sendRouteToService(route, ServiceNames.SuuntoApp, source);
    }

    async sendRouteToGarmin(route: FirestoreRouteJSON, source: 'routes_list_row' | 'routes_list_bulk' = 'routes_list_row'): Promise<void> {
        await this.sendRouteToService(route, ServiceNames.GarminAPI, source);
    }

    async sendRouteToService(
        route: FirestoreRouteJSON,
        destinationServiceName: ServiceNames,
        source: 'routes_list_row' | 'routes_list_bulk' = 'routes_list_row',
    ): Promise<void> {
        const routeID = route.id;
        const destinationLabel = this.getRouteSendDestinationLabel(destinationServiceName);
        if (
            !routeID
            || this.bulkActionInProgress()
            || this.sendingToServiceRouteID() !== null
            || this.exportingRouteID() === routeID
            || this.deletingRouteID() === routeID
            || this.downloadingRouteID() === routeID
            || this.reprocessingRouteID() === routeID
            || !this.canSendRoutesToDestination(destinationServiceName)
            || !this.canSendRouteToDestination(route, destinationServiceName)
        ) {
            return;
        }

        this.sendingToServiceRouteID.set(routeID);
        this.snackBar.open(`Sending route to ${destinationLabel}...`, undefined, { duration: 2000 });
        try {
            const result = await this.routeSendService.sendRoutesToService([routeID], destinationServiceName);
            const status = result.successCount > 0 ? 'success' : 'failure';
            this.analyticsService.logSavedRouteAction('send_service_route', {
                status,
                routeCount: 1,
                failedCount: result.failureCount,
                skippedCount: result.skippedCount,
                fileType: this.getPrimaryRouteFileType(route),
                source,
                destinationService: destinationServiceName,
            });

            this.snackBar.open(
                result.successCount > 0 ? `Route sent to ${destinationLabel}.` : getRouteSendResponseMessage(result),
                undefined,
                { duration: result.successCount > 0 ? 2500 : 3500 },
            );
        } catch (error) {
            this.analyticsService.logSavedRouteAction('send_service_route', {
                status: 'failure',
                routeCount: 1,
                fileType: this.getPrimaryRouteFileType(route),
                source,
                destinationService: destinationServiceName,
            });
            this.logger.error('[RoutesPageComponent] Failed to send route to service', {
                routeID,
                destinationServiceName,
            }, error);
            this.snackBar.open(getRouteSendErrorMessage(error, destinationServiceName), undefined, { duration: 4000 });
        } finally {
            this.sendingToServiceRouteID.set(null);
        }
    }

    async exportSelectedRoutesAsGPX(): Promise<void> {
        const selectedRoutes = this.getSelectedVisibleRouteItems();
        if (selectedRoutes.length === 0 || this.bulkActionInProgress() || this.sendingToServiceRouteID() !== null) {
            return;
        }

        this.bulkActionInProgress.set(true);
        const jobId = this.processingService.addJob('download', 'Preparing route GPX export...');
        this.processingService.updateJob(jobId, {
            status: 'processing',
            progress: 10,
            details: `${selectedRoutes.length} ${selectedRoutes.length === 1 ? 'route' : 'routes'} selected`,
        });

        const generatedFiles: { data: Blob; fileName: string; routeDate: Date | null }[] = [];
        let failedCount = 0;
        let skippedCount = 0;
        let minDate: Date | null = null;
        let maxDate: Date | null = null;

        try {
            for (let index = 0; index < selectedRoutes.length; index++) {
                const item = selectedRoutes[index];
                const routeID = item.route.id;
                const routeDate = item.routeDate;
                const originalFiles = this.routeService.getOriginalRouteFiles(item.route);
                if (!routeID || originalFiles.length === 0) {
                    skippedCount++;
                    continue;
                }

                try {
                    const result = await this.routeGPXExportService.getRouteDocumentAsGPXBlob(item.route);
                    const baseName = this.sanitizeFilenameBase(result.hydratedRoute.routeDocument.name || item.name || routeID || 'route');
                    generatedFiles.push({
                        data: result.blob,
                        fileName: this.fileService.generateDateBasedFilename(
                            routeDate,
                            'gpx',
                            index + 1,
                            selectedRoutes.length,
                            baseName,
                        ),
                        routeDate,
                    });
                    if (routeDate) {
                        if (!minDate || routeDate < minDate) minDate = routeDate;
                        if (!maxDate || routeDate > maxDate) maxDate = routeDate;
                    }
                } catch (error) {
                    failedCount++;
                    this.logger.error('[RoutesPageComponent] Failed to export selected route GPX', { routeID }, error);
                }

                this.processingService.updateJob(jobId, {
                    progress: 10 + Math.round(((index + 1) / selectedRoutes.length) * 70),
                    details: `Processed ${index + 1} of ${selectedRoutes.length}`,
                });
            }

            if (generatedFiles.length === 0) {
                this.processingService.failJob(jobId, 'No route GPX files exported');
                this.analyticsService.logSavedRouteAction('export_gpx', {
                    status: skippedCount > 0 ? 'missing_file' : 'failure',
                    routeCount: selectedRoutes.length,
                    fileCount: 0,
                    failedCount,
                    skippedCount,
                    source: 'routes_list_bulk',
                });
                this.snackBar.open('Could not export GPX for selected routes.', undefined, { duration: 3000 });
                return;
            }

            if (selectedRoutes.length === 1) {
                const file = generatedFiles[0];
                const extensionIndex = file.fileName.toLowerCase().lastIndexOf('.gpx');
                const baseName = extensionIndex > 0 ? file.fileName.slice(0, extensionIndex) : file.fileName;
                this.fileService.downloadFile(file.data, baseName, 'gpx');
            } else {
                this.processingService.updateJob(jobId, { progress: 90, details: 'Zipping route GPX files' });
                const zipFileName = this.fileService.generateDateRangeZipFilename(minDate, maxDate, 'route_gpx');
                await this.fileService.downloadAsZip(generatedFiles, zipFileName);
            }

            const status = failedCount > 0 || skippedCount > 0 ? 'partial_success' : 'success';
            this.processingService.completeJob(
                jobId,
                `Exported ${generatedFiles.length} route GPX ${generatedFiles.length === 1 ? 'file' : 'files'}`,
            );
            this.analyticsService.logSavedRouteAction('export_gpx', {
                status,
                routeCount: selectedRoutes.length,
                fileCount: generatedFiles.length,
                failedCount,
                skippedCount,
                fileType: 'gpx',
                zipped: selectedRoutes.length > 1,
                source: 'routes_list_bulk',
            });
            this.snackBar.open(
                status === 'partial_success'
                    ? `Exported ${generatedFiles.length} GPX ${generatedFiles.length === 1 ? 'file' : 'files'}. Skipped ${failedCount + skippedCount}.`
                    : selectedRoutes.length === 1 ? 'GPX file served.' : 'GPX files served.',
                undefined,
                { duration: status === 'partial_success' ? 4000 : 2000 },
            );
        } catch (error) {
            this.processingService.failJob(jobId, 'Route GPX export failed');
            this.analyticsService.logSavedRouteAction('export_gpx', {
                status: 'failure',
                routeCount: selectedRoutes.length,
                fileCount: generatedFiles.length,
                failedCount: failedCount + 1,
                skippedCount,
                source: 'routes_list_bulk',
            });
            this.logger.error('[RoutesPageComponent] Failed to export selected route GPX files', error);
            this.snackBar.open('Could not export GPX for selected routes.', undefined, { duration: 3000 });
        } finally {
            this.bulkActionInProgress.set(false);
        }
    }

    async sendSelectedRoutesToSuunto(): Promise<void> {
        await this.sendSelectedRoutesToService(ServiceNames.SuuntoApp);
    }

    async sendSelectedRoutesToGarmin(): Promise<void> {
        await this.sendSelectedRoutesToService(ServiceNames.GarminAPI);
    }

    async sendSelectedRoutesToService(destinationServiceName: ServiceNames): Promise<void> {
        const selectedRoutes = this.getSelectedVisibleRouteItems();
        const sendableRoutes = selectedRoutes.filter(item => this.canSendRouteItemToDestination(item, destinationServiceName));
        const destinationLabel = this.getRouteSendDestinationLabel(destinationServiceName);
        if (
            sendableRoutes.length === 0
            || this.bulkActionInProgress()
            || this.sendingToServiceRouteID() !== null
            || !this.canSendRoutesToDestination(destinationServiceName)
        ) {
            return;
        }

        this.bulkActionInProgress.set(true);
        const jobId = this.processingService.addJob('process', `Sending routes to ${destinationLabel}...`);
        this.processingService.updateJob(jobId, {
            status: 'processing',
            progress: 10,
            details: `${sendableRoutes.length} ${sendableRoutes.length === 1 ? 'route' : 'routes'} ready`,
        });

        try {
            const skippedBeforeSendCount = selectedRoutes.length - sendableRoutes.length;
            const routeIDs = sendableRoutes
                .map(item => item.route.id)
                .filter((routeID): routeID is string => !!routeID);
            const result = await this.routeSendService.sendRoutesToService(routeIDs, destinationServiceName, {
                onProgress: progress => {
                    this.processingService.updateJob(jobId, {
                        status: 'processing',
                        progress: 10 + Math.round((progress.processedRouteCount / progress.routeCount) * 80),
                        details: `Processed ${progress.processedRouteCount} of ${progress.routeCount}`,
                    });
                },
            });

            const successfulRouteIDs = result.results
                .filter(item => item.status === 'success')
                .map(item => item.routeId);
            this.routeSelection.deselect(...successfulRouteIDs);
            this.syncSelectedRouteIDs();

            const totalSkippedCount = result.skippedCount + skippedBeforeSendCount;
            if (result.successCount === 0) {
                this.processingService.failJob(jobId, `No routes sent to ${destinationLabel}`);
                this.analyticsService.logSavedRouteAction('send_service_route', {
                    status: 'failure',
                    routeCount: selectedRoutes.length,
                    failedCount: result.failureCount,
                    skippedCount: totalSkippedCount,
                    source: 'routes_list_bulk',
                    destinationService: destinationServiceName,
                });
                this.snackBar.open(getRouteSendResponseMessage(result), undefined, { duration: 4000 });
                return;
            }

            const status = result.status === 'success' && totalSkippedCount === 0 ? 'success' : 'partial_success';
            const guidanceMessage = status === 'partial_success'
                ? getActionableRouteSendResponseMessage(result)
                : null;
            this.processingService.completeJob(
                jobId,
                `Sent ${result.successCount} ${result.successCount === 1 ? 'route' : 'routes'} to ${destinationLabel}`,
            );
            this.analyticsService.logSavedRouteAction('send_service_route', {
                status,
                routeCount: selectedRoutes.length,
                failedCount: result.failureCount,
                skippedCount: totalSkippedCount,
                source: 'routes_list_bulk',
                destinationService: destinationServiceName,
            });
            this.snackBar.open(
                status === 'partial_success'
                    ? this.getBulkRouteSendSummaryMessage(destinationServiceName, result.successCount, result.failureCount, totalSkippedCount, guidanceMessage)
                    : `Sent ${result.successCount} ${result.successCount === 1 ? 'route' : 'routes'} to ${destinationLabel}.`,
                undefined,
                { duration: status === 'partial_success' ? 4000 : 2500 },
            );
        } catch (error) {
            this.processingService.failJob(jobId, 'Route send failed');
            this.analyticsService.logSavedRouteAction('send_service_route', {
                status: 'failure',
                routeCount: selectedRoutes.length,
                source: 'routes_list_bulk',
                destinationService: destinationServiceName,
            });
            this.logger.error('[RoutesPageComponent] Failed to send selected routes to service', {
                destinationServiceName,
            }, error);
            this.snackBar.open(getRouteSendErrorMessage(error, destinationServiceName), undefined, { duration: 4000 });
        } finally {
            this.bulkActionInProgress.set(false);
        }
    }

    async downloadSelectedRouteOriginals(): Promise<void> {
        const selectedRoutes = this.getSelectedVisibleRouteItems();
        if (selectedRoutes.length === 0 || this.bulkActionInProgress() || this.sendingToServiceRouteID() !== null) {
            return;
        }

        let skippedCount = 0;
        const originalFileEntries = selectedRoutes.flatMap(item => {
            const originalFiles = this.routeService.getOriginalRouteFiles(item.route);
            if (originalFiles.length === 0) {
                skippedCount++;
            }
            return originalFiles.map(file => ({
                item,
                file,
            }));
        });

        if (originalFileEntries.length === 0) {
            this.analyticsService.logSavedRouteAction('download', {
                status: 'missing_file',
                routeCount: selectedRoutes.length,
                fileCount: 0,
                skippedCount,
                source: 'routes_list_bulk',
            });
            this.snackBar.open('No original route files found for the selected routes.', undefined, { duration: 3000 });
            return;
        }

        this.bulkActionInProgress.set(true);
        const jobId = this.processingService.addJob('download', 'Preparing original route files...');
        this.processingService.updateJob(jobId, {
            status: 'processing',
            progress: 10,
            details: `${originalFileEntries.length} ${originalFileEntries.length === 1 ? 'file' : 'files'} found`,
        });

        try {
            const result = await this.originalFileDownloadService.downloadOriginalFiles({
                sources: originalFileEntries.map(entry => ({
                    ...entry.file,
                    fallbackDate: entry.item.routeDate,
                    routeID: entry.item.route.id,
                })),
                downloadFile: (path) => this.routeService.downloadOriginalFile(path),
                zipSuffix: 'route_originals',
                fallbackFileName: 'original-route-file',
                zipSingleFile: true,
                continueOnFailure: true,
                onFileFailed: (source, error) => {
                    this.logger.error('[RoutesPageComponent] Failed to download selected route original file', { routeID: source.routeID, path: source.path }, error);
                },
                onFileProcessed: ({ completed, total, downloadedCount }) => {
                    this.processingService.updateJob(jobId, {
                        progress: 10 + Math.round((completed / total) * 70),
                        details: `Downloaded ${downloadedCount} of ${total}`,
                    });
                },
            });

            if (result.mode === 'none') {
                this.processingService.failJob(jobId, 'No original route files downloaded');
                this.analyticsService.logSavedRouteAction('download', {
                    status: 'failure',
                    routeCount: selectedRoutes.length,
                    fileCount: 0,
                    failedCount: result.failedCount,
                    skippedCount,
                    source: 'routes_list_bulk',
                });
                this.snackBar.open('Could not download original files for selected routes.', undefined, { duration: 3000 });
                return;
            }

            this.processingService.updateJob(jobId, {
                progress: 90,
                details: result.mode === 'zip' ? 'Zipping original route files' : 'Finalizing original route download',
            });
            const status = result.failedCount > 0 || skippedCount > 0 ? 'partial_success' : 'success';
            this.processingService.completeJob(
                jobId,
                `Downloaded ${result.downloadedCount} original route ${result.downloadedCount === 1 ? 'file' : 'files'}`,
            );
            this.analyticsService.logSavedRouteAction('download', {
                status,
                routeCount: selectedRoutes.length,
                fileCount: result.downloadedCount,
                failedCount: result.failedCount,
                skippedCount,
                zipped: result.mode === 'zip',
                source: 'routes_list_bulk',
            });
            this.snackBar.open(
                status === 'partial_success'
                    ? this.getBulkOriginalRouteDownloadSummaryMessage(result.downloadedCount, result.failedCount, skippedCount)
                    : 'Original route files served.',
                undefined,
                { duration: status === 'partial_success' ? 4000 : 2000 },
            );
        } catch (error) {
            this.processingService.failJob(jobId, 'Original route file download failed');
            this.analyticsService.logSavedRouteAction('download', {
                status: 'failure',
                routeCount: selectedRoutes.length,
                fileCount: 0,
                failedCount: 1,
                skippedCount,
                zipped: originalFileEntries.length > 1,
                source: 'routes_list_bulk',
            });
            this.logger.error('[RoutesPageComponent] Failed to download selected route original files', error);
            this.snackBar.open('Could not download original files for selected routes.', undefined, { duration: 3000 });
        } finally {
            this.bulkActionInProgress.set(false);
        }
    }

    async confirmDeleteSelectedRoutes(): Promise<void> {
        const selectedRoutes = this.getSelectedVisibleRouteItems();
        const user = this.user();
        if (!user || selectedRoutes.length === 0 || this.bulkActionInProgress() || this.sendingToServiceRouteID() !== null) {
            return;
        }

        const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
            data: {
                title: `Delete ${selectedRoutes.length} selected ${selectedRoutes.length === 1 ? 'route' : 'routes'}?`,
                message: `Delete ${selectedRoutes.length} selected ${selectedRoutes.length === 1 ? 'route' : 'routes'} and their original files?`,
                confirmText: 'Delete',
                confirmColor: 'warn',
            } as ConfirmationDialogData,
        });

        const confirmed = await firstValueFrom(dialogRef.afterClosed());
        if (!confirmed) {
            return;
        }

        this.bulkActionInProgress.set(true);
        const jobId = this.processingService.addJob('process', 'Deleting selected routes...');
        this.processingService.updateJob(jobId, { status: 'processing', progress: 10 });
        const failedRouteIDs: string[] = [];
        let deletedCount = 0;

        try {
            for (let index = 0; index < selectedRoutes.length; index++) {
                const item = selectedRoutes[index];
                const routeID = item.route.id;
                if (!routeID) {
                    failedRouteIDs.push('');
                    continue;
                }

                try {
                    await this.routeService.deleteRoute(user, routeID);
                    deletedCount++;
                } catch (error) {
                    failedRouteIDs.push(routeID);
                    this.logger.error('[RoutesPageComponent] Failed to delete selected route', { routeID }, error);
                }

                this.processingService.updateJob(jobId, {
                    progress: 10 + Math.round(((index + 1) / selectedRoutes.length) * 80),
                    details: `Deleted ${deletedCount} of ${selectedRoutes.length}`,
                });
            }

            const routeCount = await this.refreshRouteCount();
            this.routeSelection.clear();
            this.routeSelection.select(...failedRouteIDs.filter(Boolean));
            this.syncSelectedRouteIDs();

            if (deletedCount === 0) {
                this.processingService.failJob(jobId, 'No selected routes deleted');
                this.analyticsService.logSavedRouteAction('delete', {
                    status: 'failure',
                    routeCount,
                    failedCount: failedRouteIDs.length,
                    source: 'routes_list_bulk',
                });
                this.snackBar.open('Failed to delete selected routes.', undefined, { duration: 3000 });
                return;
            }

            const status = failedRouteIDs.length > 0 ? 'partial_success' : 'success';
            this.processingService.completeJob(jobId, `Deleted ${deletedCount} ${deletedCount === 1 ? 'route' : 'routes'}`);
            this.analyticsService.logSavedRouteAction('delete', {
                status,
                routeCount,
                failedCount: failedRouteIDs.length,
                source: 'routes_list_bulk',
            });
            this.snackBar.open(
                status === 'partial_success'
                    ? `Deleted ${deletedCount} ${deletedCount === 1 ? 'route' : 'routes'}. Failed ${failedRouteIDs.length}.`
                    : `Deleted ${deletedCount} ${deletedCount === 1 ? 'route' : 'routes'}.`,
                undefined,
                { duration: status === 'partial_success' ? 4000 : 2500 },
            );
        } catch (error) {
            this.processingService.failJob(jobId, 'Selected route delete failed');
            this.analyticsService.logSavedRouteAction('delete', {
                status: 'failure',
                failedCount: selectedRoutes.length - deletedCount,
                source: 'routes_list_bulk',
            });
            this.logger.error('[RoutesPageComponent] Failed to delete selected routes', error);
            this.snackBar.open('Failed to delete selected routes.', undefined, { duration: 3000 });
        } finally {
            this.bulkActionInProgress.set(false);
        }
    }

    async reprocessRouteFromOriginalFile(route: FirestoreRouteJSON): Promise<void> {
        const user = this.user();
        const routeID = route.id;
        if (
            !user
            || !routeID
            || this.reprocessingRouteID() !== null
            || this.bulkActionInProgress()
            || this.exportingRouteID() === routeID
            || this.deletingRouteID() === routeID
            || this.downloadingRouteID() === routeID
            || this.sendingToServiceRouteID() === routeID
            || !this.canManageRoute(route)
        ) {
            return;
        }

        const originalFiles = this.routeService.getOriginalRouteFiles(route);
        if (originalFiles.length === 0) {
            this.analyticsService.logSavedRouteAction('reprocess', {
                status: 'missing_file',
                fileCount: 0,
                fileType: this.getPrimaryRouteFileType(route),
            });
            this.snackBar.open('No original route file found.', undefined, { duration: 3000 });
            return;
        }

        const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
            data: {
                title: 'Reprocess route from original file?',
                message: 'This will reparse the saved route source file and rebuild route statistics, segments, map bounds, and waypoint counts.',
                confirmLabel: 'Reprocess',
                confirmColor: 'primary',
            } as ConfirmationDialogData,
        });

        const confirmed = await firstValueFrom(dialogRef.afterClosed());
        if (!confirmed) {
            return;
        }

        this.reprocessingRouteID.set(routeID);
        this.snackBar.open('Reprocessing route from source file...', undefined, { duration: 2000 });
        const jobId = this.processingService.addJob('process', 'Reprocessing route from source file...');
        this.processingService.updateJob(jobId, { status: 'processing', progress: 5 });

        try {
            const reprocessedRoute = await this.routeReprocessService.reprocessRouteDocumentFromOriginalFile(user, route, {
                onProgress: (progress) => this.updateReprocessJob(jobId, progress),
            });
            this.processingService.completeJob(jobId, 'Route reprocess completed');
            this.analyticsService.logSavedRouteAction('reprocess', {
                status: 'success',
                fileCount: reprocessedRoute.sourceFilesCount,
                routeCount: reprocessedRoute.routeCount,
                fileType: this.getPrimaryRouteFileType(reprocessedRoute.routeDocument),
            });
            this.snackBar.open('Route reprocessed from source file.', undefined, { duration: 2500 });
        } catch (error) {
            this.processingService.failJob(jobId, 'Route reprocess failed');
            this.analyticsService.logSavedRouteAction('reprocess', {
                status: 'failure',
                fileCount: originalFiles.length,
                fileType: this.getPrimaryRouteFileType(route),
            });
            this.logger.error('[RoutesPageComponent] Failed to reprocess route', { routeID }, error);
            this.snackBar.open(getRouteReprocessErrorMessage(error), undefined, { duration: 4000 });
        } finally {
            this.reprocessingRouteID.set(null);
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

    private canManageRoute(route: FirestoreRouteJSON): boolean {
        const user = this.user();
        return !!user?.uid && !!route.userID && user.uid === route.userID;
    }

    private canSendRouteToSuunto(route: FirestoreRouteJSON): boolean {
        return this.canManageRoute(route)
            && this.routeService.getOriginalRouteFiles(route).length > 0
            && canSendRouteToConnectedSuuntoAccounts(route, this.connectedSuuntoProviderUserIds());
    }

    private canSendRouteToGarmin(route: FirestoreRouteJSON): boolean {
        return this.canManageRoute(route)
            && this.routeService.getOriginalRouteFiles(route).length > 0
            && canSendRouteToConnectedGarminAccount(route, this.garminRouteSendContext());
    }

    private getGarminSendDisabledReason(route: FirestoreRouteJSON): string | null {
        if (!this.canManageRoute(route) || this.routeService.getOriginalRouteFiles(route).length === 0) {
            return null;
        }

        return getGarminRouteSendDisabledReason(route, this.garminRouteSendContext());
    }

    private canSendRoutesToDestination(destinationServiceName: ServiceNames): boolean {
        switch (destinationServiceName) {
            case ServiceNames.SuuntoApp:
                return this.canSendRoutesToSuunto();
            case ServiceNames.GarminAPI:
                return this.canSendRoutesToGarmin();
            default:
                return false;
        }
    }

    private canSendRouteToDestination(route: FirestoreRouteJSON, destinationServiceName: ServiceNames): boolean {
        switch (destinationServiceName) {
            case ServiceNames.SuuntoApp:
                return this.canSendRouteToSuunto(route);
            case ServiceNames.GarminAPI:
                return this.canSendRouteToGarmin(route);
            default:
                return false;
        }
    }

    private canSendRouteItemToDestination(
        item: Pick<RoutePageRouteViewModel, 'canSendToSuunto' | 'canSendToGarmin'>,
        destinationServiceName: ServiceNames,
    ): boolean {
        switch (destinationServiceName) {
            case ServiceNames.SuuntoApp:
                return item.canSendToSuunto;
            case ServiceNames.GarminAPI:
                return item.canSendToGarmin;
            default:
                return false;
        }
    }

    private async openSubscriptions(): Promise<void> {
        await this.router.navigate(['/subscriptions']);
    }

    private getSelectedVisibleRouteItems(): RoutePageRouteViewModel[] {
        const selectedIDs = new Set(this.selectedRouteIDs());
        return this.visibleRouteViewModels().filter(item => (
            !!item.route.id
            && selectedIDs.has(item.route.id)
            && this.canManageRoute(item.route)
        ));
    }

    private getBulkRouteSendSummaryMessage(
        destinationServiceName: ServiceNames,
        successCount: number,
        failureCount: number,
        skippedCount: number,
        guidanceMessage: string | null,
    ): string {
        const destinationLabel = this.getRouteSendDestinationLabel(destinationServiceName);
        const routeLabel = successCount === 1 ? 'route' : 'routes';
        const messageParts = [`Sent ${successCount} ${routeLabel} to ${destinationLabel}.`];
        if (failureCount > 0) {
            messageParts.push(`Failed ${failureCount}.`);
        }
        if (skippedCount > 0) {
            messageParts.push(`Skipped ${skippedCount}.`);
        }
        if (guidanceMessage) {
            messageParts.push(guidanceMessage);
        }
        return messageParts.join(' ');
    }

    private getBulkOriginalRouteDownloadSummaryMessage(
        downloadedCount: number,
        failedCount: number,
        skippedCount: number,
    ): string {
        const messageParts = [`Downloaded ${downloadedCount} original ${downloadedCount === 1 ? 'file' : 'files'}.`];
        if (failedCount > 0) {
            messageParts.push(`Failed ${failedCount}.`);
        }
        if (skippedCount > 0) {
            messageParts.push(`Skipped ${skippedCount}.`);
        }
        return messageParts.join(' ');
    }

    private reconcileSelectionWithVisibleRoutes(visibleRoutes: RoutePageRouteViewModel[]): void {
        const visibleIDs = new Set(
            visibleRoutes
                .map(item => item.route.id)
                .filter((routeID): routeID is string => !!routeID),
        );
        const selectedIDs = [...this.routeSelection.selected];
        let changed = false;
        selectedIDs.forEach((routeID) => {
            if (!visibleIDs.has(routeID)) {
                this.routeSelection.deselect(routeID);
                changed = true;
            }
        });
        if (changed || this.selectedRouteIDs().length !== this.routeSelection.selected.length) {
            this.syncSelectedRouteIDs();
        }
    }

    private syncSelectedRouteIDs(): void {
        this.selectedRouteIDs.set([...this.routeSelection.selected]);
    }

    private updateReprocessJob(jobId: string, progress: RouteReprocessProgress): void {
        this.processingService.updateJob(jobId, {
            status: progress.phase === 'done' ? 'completed' : 'processing',
            title: getRouteReprocessProgressTitle(progress.phase),
            progress: progress.progress,
            details: progress.details,
        });
    }

    private toRouteViewModel(route: FirestoreRouteJSON): RoutePageRouteViewModel {
        const originalFiles = this.routeService.getOriginalRouteFiles(route);
        const file = originalFiles[0];
        const routeDate = this.resolveRouteDate(route);
        const routeCount = this.toFiniteNumber(route.routeCount) ?? 0;
        const pointCount = this.toFiniteNumber(route.pointCount) ?? 0;
        const waypointCount = this.toFiniteNumber(route.waypointCount) ?? 0;
        const activityTypeSummaries = this.buildRouteActivityTypeSummaries(route);
        const activityTypes = activityTypeSummaries.map(summary => summary.activityTypeLabel).join(', ') || 'Route';
        const originalFilename = file
            ? this.fileService.resolveOriginalSourceFileName(file, file.extension || route.srcFileType || 'route', 'Original file')
            : 'Original file';
        const fileType = route.srcFileType || file?.extension || 'route';
        const fileTypeFilterValue = this.normalizeFilterValue(fileType);
        const activityTypeFilterValues = this.getDistinctLabels(activityTypeSummaries.map(summary => summary.activityTypeLabel));
        const distance = this.buildRouteMetricCell(route, [DataDistance.type, 'Distance', 'distance'], 'Distance', DataDistance.type);
        const ascent = this.buildRouteMetricCell(route, [DataAscent.type, 'Ascent', 'ascent'], 'Ascent', DataAscent.type);
        const descent = this.buildRouteMetricCell(route, [DataDescent.type, 'Descent', 'descent'], 'Descent', DataDescent.type);
        const minGrade = this.buildRouteMetricCell(
            route,
            [DataGradeMin.type, 'minGrade', 'gradeMin', 'minimumGrade'],
            'Minimum grade',
            DataGradeMin.type,
        );
        const maxGrade = this.buildRouteMetricCell(
            route,
            [DataGradeMax.type, 'maxGrade', 'gradeMax', 'maximumGrade'],
            'Maximum grade',
            DataGradeMax.type,
        );
        const routeName = route.name || 'Untitled route';
        const routeCountLabel = `${routeCount} route${routeCount === 1 ? '' : 's'}`;
        const pointCountLabel = `${pointCount} point${pointCount === 1 ? '' : 's'}`;
        const waypointCountLabel = waypointCount > 0 ? `${waypointCount} waypoint${waypointCount === 1 ? '' : 's'}` : null;
        const sourceSummary = getRouteSourceSummary(route);
        const sourcePresentation = sourceSummary.presentation;
        const sourceServiceLabel = sourcePresentation?.displayLabel
            || (sourceSummary.serviceName ? getRouteServiceDisplayName(sourceSummary.serviceName) : sourceSummary.label);
        const provenanceItems = this.buildRouteProvenanceItems(route);
        const provenanceSummary = provenanceItems.map(item => item.label).join(' · ');
        const garminSendDisabledReason = this.getGarminSendDisabledReason(route);
        const garminSendMenuLabel = getGarminRouteSendMenuLabel(garminSendDisabledReason);
        return {
            route,
            name: routeName,
            routeDate,
            routeDateSortMs: routeDate ? routeDate.getTime() : null,
            sourcePresentation,
            sourceServiceLabel,
            sourceServiceTitle: sourceSummary.label,
            sourceServiceName: sourceSummary.serviceName,
            activityTypes,
            activityTypeSummaries,
            activityTypeFilterValues,
            activityTypesTitle: activityTypeSummaries.map(summary => summary.activityTypeLabel).join('\n') || 'Route',
            fileType,
            fileTypeFilterValue,
            originalFilename,
            routeCountLabel,
            pointCountLabel,
            waypointCountLabel,
            provenanceSummary,
            provenanceTitle: provenanceSummary,
            provenanceItems,
            distance,
            ascent,
            descent,
            minGrade,
            maxGrade,
            canReprocess: this.canManageRoute(route) && originalFiles.length > 0,
            canExportGPX: this.canManageRoute(route) && originalFiles.length > 0,
            canDownloadOriginals: this.canManageRoute(route) && originalFiles.length > 0,
            canSendToSuunto: this.canSendRouteToSuunto(route),
            canSendToGarmin: this.canSendRouteToGarmin(route),
            garminSendDisabledReason,
            garminSendMenuLabel,
            canDelete: this.canManageRoute(route),
            filterText: [
                routeName,
                sourceServiceLabel,
                sourceSummary.label,
                activityTypes,
                originalFilename,
                fileType,
                provenanceSummary,
                routeDate ? routeDate.toISOString() : '',
                routeCountLabel,
                pointCountLabel,
                waypointCountLabel,
                distance.label,
                ascent.label,
                descent.label,
                minGrade.label,
                maxGrade.label,
            ].filter(Boolean).join(' ').toLowerCase(),
        };
    }

    private buildRouteProvenanceItems(route: FirestoreRouteJSON): RouteProvenanceItem[] {
        const sourceSummary = getRouteSourceSummary(route);
        const destinationSummaries = getRouteSyncedDestinationSummaries(route);

        return [
            {
                id: 'source',
                label: sourceSummary.label,
                title: sourceSummary.label,
                serviceName: sourceSummary.serviceName,
            },
            ...destinationSummaries.map((summary, index) => ({
                id: `destination-${summary.serviceName || index}`,
                label: summary.label,
                title: summary.label,
                serviceName: summary.serviceName,
            })),
        ];
    }

    private buildRouteActivityTypeSummaries(route: FirestoreRouteJSON): RouteActivityTypeSummary[] {
        const labels = this.getDistinctActivityTypeLabels(route.activityTypes || []);
        const activityTypeLabels = labels.length > 0 ? labels : ['Route'];
        return activityTypeLabels.map((activityTypeLabel, index) => ({
            id: `${this.normalizeActivityTypeSummaryID(activityTypeLabel) || 'route'}-${index}`,
            activityTypeLabel,
            activityTypeIconValue: activityTypeLabel,
        }));
    }

    private getDistinctActivityTypeLabels(activityTypes: unknown[]): string[] {
        const labels: string[] = [];
        const seenLabels = new Set<string>();
        activityTypes.forEach((activityType) => {
            const label = this.formatActivityTypeName(activityType);
            const labelKey = label.toLowerCase();
            if (!label || seenLabels.has(labelKey)) {
                return;
            }
            seenLabels.add(labelKey);
            labels.push(label);
        });
        return labels;
    }

    private formatActivityTypeName(type: unknown): string {
        if (typeof type === 'number') {
            const numericActivityType = (ActivityTypes as Record<string, string>)[String(type)];
            return numericActivityType || `${type}`;
        }

        if (typeof type !== 'string') {
            return '';
        }

        const raw = type.trim();
        if (!raw) {
            return '';
        }

        const resolvedActivityType = ActivityTypesHelper.resolveActivityType(raw);
        if (resolvedActivityType) {
            return resolvedActivityType;
        }

        const enumActivityType = (ActivityTypes as Record<string, string>)[raw];
        if (enumActivityType) {
            return enumActivityType;
        }

        if ((Object.values(ActivityTypes) as string[]).includes(raw)) {
            return raw;
        }

        const normalized = raw
            .replace(/[_-]+/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\s+/g, ' ');
        return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '';
    }

    private normalizeActivityTypeSummaryID(activityType: string): string {
        return activityType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    private getDistinctLabels(labels: string[]): string[] {
        const distinctLabels: string[] = [];
        const seenLabels = new Set<string>();
        labels.forEach((label) => {
            const normalizedLabel = `${label || ''}`.trim();
            const key = normalizedLabel.toLowerCase();
            if (!normalizedLabel || seenLabels.has(key)) {
                return;
            }
            seenLabels.add(key);
            distinctLabels.push(normalizedLabel);
        });
        return distinctLabels;
    }

    private resolveRouteDate(route: FirestoreRouteJSON): Date | null {
        return this.toDate(route.createdAt) || this.toDate(route.importedAt);
    }

    private buildRouteMetricCell(
        route: FirestoreRouteJSON,
        statAliases: string[],
        metricLabel: string,
        dataType: string,
    ): RouteMetricCell {
        const value = this.readRouteStatValue(route.stats, statAliases);
        const label = value === null
            ? '-'
            : this.formatRouteMetricValue(dataType, value);

        return {
            label,
            sortValue: value,
            title: value === null ? `${metricLabel} unknown` : `${metricLabel}: ${label}`,
        };
    }

    private readRouteStatValue(stats: Record<string, unknown> | undefined, aliases: string[]): number | null {
        if (!stats || typeof stats !== 'object') {
            return null;
        }

        for (const alias of aliases) {
            if (!Object.prototype.hasOwnProperty.call(stats, alias)) {
                continue;
            }

            const value = this.toFiniteNumber(stats[alias]);
            if (value !== null) {
                return value;
            }

            const rawStat = stats[alias];
            if (!rawStat || typeof rawStat !== 'object' || Array.isArray(rawStat)) {
                continue;
            }

            const statObject = rawStat as Record<string, unknown>;
            const objectValue = this.toFiniteNumber(statObject.value)
                ?? this.toFiniteNumber(statObject.rawValue)
                ?? this.toFiniteNumber(statObject._value);
            if (objectValue !== null) {
                return objectValue;
            }
        }

        return null;
    }

    private toFiniteNumber(value: unknown): number | null {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        if (typeof value === 'string') {
            const normalizedValue = value.trim();
            if (!normalizedValue) {
                return null;
            }
            const numericValue = Number(normalizedValue);
            return Number.isFinite(numericValue) ? numericValue : null;
        }
        return null;
    }

    private formatRouteMetricValue(dataType: string, value: number): string {
        return resolveUnitAwareDisplayFromValue(dataType, value, this.user()?.settings?.unitSettings ?? null, {
            stripRepeatedUnit: true,
            compactAscentDescent: true,
        })?.text ?? `${Math.round(value)}`;
    }

    private sortRouteViewModels(
        routes: RoutePageRouteViewModel[],
        routeSort: RouteSortState,
    ): RoutePageRouteViewModel[] {
        const direction = routeSort.direction || 'asc';
        return [...routes].sort((first, second) => {
            const result = this.compareRouteViewModels(first, second, routeSort.active, direction);
            return result !== 0 ? result : first.name.localeCompare(second.name, undefined, { sensitivity: 'base' });
        });
    }

    private compareRouteViewModels(
        first: RoutePageRouteViewModel,
        second: RoutePageRouteViewModel,
        active: RouteSortColumn,
        direction: SortDirection,
    ): number {
        switch (active) {
            case 'date':
                return this.compareNullableNumbers(first.routeDateSortMs, second.routeDateSortMs, direction);
            case 'name':
                return this.compareText(first.name, second.name, direction);
            case 'sourceService':
                return this.compareText(first.sourceServiceTitle, second.sourceServiceTitle, direction);
            case 'activityTypes':
                return this.compareText(first.activityTypes, second.activityTypes, direction);
            case 'distance':
                return this.compareNullableNumbers(first.distance.sortValue, second.distance.sortValue, direction);
            case 'ascent':
                return this.compareNullableNumbers(first.ascent.sortValue, second.ascent.sortValue, direction);
            case 'descent':
                return this.compareNullableNumbers(first.descent.sortValue, second.descent.sortValue, direction);
            case 'minGrade':
                return this.compareNullableNumbers(first.minGrade.sortValue, second.minGrade.sortValue, direction);
            case 'maxGrade':
                return this.compareNullableNumbers(first.maxGrade.sortValue, second.maxGrade.sortValue, direction);
            case 'pointCount':
                return this.compareNullableNumbers(
                    this.toFiniteNumber(first.route.pointCount),
                    this.toFiniteNumber(second.route.pointCount),
                    direction,
                );
            case 'originalFilename':
                return this.compareText(first.originalFilename, second.originalFilename, direction);
        }
    }

    private filterRouteViewModels(
        routes: RoutePageRouteViewModel[],
        routeFilter: RouteFilterState,
    ): RoutePageRouteViewModel[] {
        const text = routeFilter.text.trim().toLowerCase();
        const fileType = this.normalizeFilterValue(routeFilter.fileType);
        const activityType = this.normalizeFilterValue(routeFilter.activityType);
        if (!text && !fileType && !activityType) {
            return routes;
        }

        return routes.filter((route) => {
            if (text && !route.filterText.includes(text)) {
                return false;
            }
            if (fileType && route.fileTypeFilterValue !== fileType) {
                return false;
            }
            if (activityType && !route.activityTypeFilterValues.some(value => this.normalizeFilterValue(value) === activityType)) {
                return false;
            }
            return true;
        });
    }

    private buildRouteFileTypeFilterOptions(routes: RoutePageRouteViewModel[]): RouteFilterOption[] {
        return this.buildRouteFilterOptions(routes.map(route => route.fileType), label => label.toUpperCase());
    }

    private buildRouteActivityTypeFilterOptions(routes: RoutePageRouteViewModel[]): RouteFilterOption[] {
        return this.buildRouteFilterOptions(routes.flatMap(route => route.activityTypeFilterValues));
    }

    private buildRouteFilterOptions(
        values: string[],
        formatLabel: (label: string) => string = label => label,
    ): RouteFilterOption[] {
        const labelByValue = new Map<string, string>();
        values.forEach((value) => {
            const label = `${value || ''}`.trim();
            const normalizedValue = this.normalizeFilterValue(label);
            if (!label || !normalizedValue || labelByValue.has(normalizedValue)) {
                return;
            }
            labelByValue.set(normalizedValue, formatLabel(label));
        });
        return Array.from(labelByValue.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((first, second) => first.label.localeCompare(second.label, undefined, { sensitivity: 'base' }));
    }

    private emitRouteFilterState(): void {
        const routeFilterState = this.getRouteFilterState();
        this.filteredRouteCount.set(this.filterRouteViewModels(this.loadedRouteViewModels(), routeFilterState).length);
        this.routeFilterSubject.next(routeFilterState);
    }

    private getRouteFilterState(): RouteFilterState {
        return {
            text: this.routeFilter(),
            fileType: this.routeFileTypeFilter(),
            activityType: this.routeActivityTypeFilter(),
        };
    }

    private applyRouteFacetFilterChange(): void {
        this.emitRouteFilterState();
        this.hapticsService.selection();
        this.analyticsService.logSavedRouteAction('filter', {
            status: this.isRouteFilterActive() ? 'applied' : 'cleared',
            filterActive: this.isRouteFilterActive(),
            resultCount: this.filteredRouteCount(),
        });
    }

    private isRouteFilterActive(): boolean {
        return !!(
            this.routeFilter().trim()
            || this.routeFileTypeFilter()
            || this.routeActivityTypeFilter()
        );
    }

    private normalizeFilterValue(value: string): string {
        return `${value || ''}`.trim().toLowerCase();
    }

    private compareText(first: string, second: string, direction: SortDirection): number {
        const result = first.localeCompare(second, undefined, { sensitivity: 'base' });
        return direction === 'desc' ? -result : result;
    }

    private compareNullableNumbers(first: number | null, second: number | null, direction: SortDirection): number {
        if (first === null && second === null) return 0;
        if (first === null) return 1;
        if (second === null) return -1;
        const result = first - second;
        return direction === 'desc' ? -result : result;
    }

    private isRouteSortColumn(value: string): value is RouteSortColumn {
        return [
            'date',
            'name',
            'sourceService',
            'activityTypes',
            'distance',
            'ascent',
            'descent',
            'minGrade',
            'maxGrade',
            'pointCount',
            'originalFilename',
        ].includes(value);
    }

    private toRouteListSort(routeSort: RouteSortState): RouteListSort {
        if (!isRouteListServerSortColumn(routeSort.active)) {
            return ROUTE_LIST_DEFAULT_SORT;
        }

        return {
            active: routeSort.active,
            direction: routeSort.direction === 'asc' ? 'asc' : 'desc',
        };
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

    private getPrimaryRouteFileType(route: FirestoreRouteJSON): string {
        const file = this.routeService.getOriginalRouteFiles(route)[0];
        return this.fileService.getExtensionFromPath(file?.path || '', file?.extension || route.srcFileType || 'route');
    }
}
