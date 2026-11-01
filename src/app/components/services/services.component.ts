import { afterNextRender, type AfterRenderRef, Component, inject, Injector, OnDestroy, OnInit, TemplateRef, ViewChild, signal } from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { AppFileService } from '../../services/app.file.service';
import { Subscription, combineLatest, from, of, catchError, take } from 'rxjs';
import { AppEventService } from '../../services/app.event.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ActivatedRoute, Router } from '@angular/router';
import { AppWindowService } from '../../services/app.window.service';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTES } from '@shared/activity-sync-routes';
import { isActivitySyncRouteUIDAllowlisted } from '@shared/activity-sync-rollout';
import { ROUTE_DELIVERY_SYNC_ROUTES } from '@shared/route-delivery-sync-routes';
import { isRouteDeliverySyncRouteUIDAllowlisted } from '@shared/route-delivery-sync-rollout';
import { getProviderDisplayName } from '@shared/provider-presentation';
import { AppUserInterface } from '../../models/app-user.interface';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppUserUtilities } from '../../utils/app.user.utilities';
import { AppPaymentService } from '../../services/app.payment.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { HistoryImportProgressService } from '../../services/history-import-progress.service';
import { ProMembershipOffer, resolveProMembershipOffer } from '../../helpers/membership-selection.helper';
import {
  PROVIDER_SECTION_BY_SERVICE,
  buildProviderDataFlowSummary,
  createEmptyProviderDataFlowSummary,
  type ProviderDataFlowActivityDestination,
  type ProviderDataFlowToolId,
  type ProviderServiceSectionId,
} from '../shared/provider-data-flow-matrix/provider-data-flow-matrix.helper';

type ServiceSectionId = ProviderServiceSectionId | 'mcp';
type ServiceToolId = 'history' | 'uploads' | 'historical-send' | 'send-activities' | ProviderDataFlowToolId;
type ServiceDataFlowActivityDestination = ProviderDataFlowActivityDestination;

interface ServiceSectionOption {
  id: ServiceSectionId;
  label: string;
  providerId: ProviderServiceSectionId | null;
  serviceName: ServiceNames | null;
  requiresPro: boolean;
  href: string;
}

interface ServiceToolLaunch {
  tool: ServiceToolId;
  title: string;
  activitySyncDestination?: ServiceDataFlowActivityDestination;
}

interface ServiceOverviewCard extends ServiceToolLaunch {
  title: string;
  description: string;
  icon: string;
  actionLabel: string;
}

interface ServiceAutomaticSyncRoute {
  id: string;
  label: string;
}

interface ServiceAutomaticSyncSummary {
  activities: readonly ServiceAutomaticSyncRoute[];
  routes: readonly ServiceAutomaticSyncRoute[];
}

function createEmptyAutomaticSyncSummaryBySection(): Record<ProviderServiceSectionId, ServiceAutomaticSyncSummary> {
  return {
    garmin: { activities: [], routes: [] },
    suunto: { activities: [], routes: [] },
    coros: { activities: [], routes: [] },
    wahoo: { activities: [], routes: [] },
  };
}

function buildAutomaticSyncRouteLabel(
  sourceServiceName: ServiceNames,
  destinationServiceName: ServiceNames,
): string {
  return `${getProviderDisplayName(sourceServiceName, 'source')} → ${getProviderDisplayName(destinationServiceName, 'destination')}`;
}

function buildAutomaticSyncSummaryBySection(
  user: AppUserInterface | null | undefined,
): Record<ProviderServiceSectionId, ServiceAutomaticSyncSummary> {
  const summaries = createEmptyAutomaticSyncSummaryBySection();
  const serviceSyncSettings = user?.settings?.serviceSyncSettings;
  const activitySettings = serviceSyncSettings?.activitySyncRoutes || {};
  const routeSettings = serviceSyncSettings?.routeDeliverySyncRoutes || {};

  for (const route of Object.values(ACTIVITY_SYNC_ROUTES)) {
    if (activitySettings[route.id]?.enabled !== true
      || !isActivitySyncRouteUIDAllowlisted(route.id, `${user?.uid || ''}`)) {
      continue;
    }

    const summaryRoute: ServiceAutomaticSyncRoute = {
      id: route.id,
      label: buildAutomaticSyncRouteLabel(route.sourceServiceName, route.destinationServiceName),
    };
    summaries[PROVIDER_SECTION_BY_SERVICE[route.sourceServiceName]].activities = [
      ...summaries[PROVIDER_SECTION_BY_SERVICE[route.sourceServiceName]].activities,
      summaryRoute,
    ];
    summaries[PROVIDER_SECTION_BY_SERVICE[route.destinationServiceName]].activities = [
      ...summaries[PROVIDER_SECTION_BY_SERVICE[route.destinationServiceName]].activities,
      summaryRoute,
    ];
  }

  for (const route of Object.values(ROUTE_DELIVERY_SYNC_ROUTES)) {
    if (routeSettings[route.id]?.enabled !== true
      || !isRouteDeliverySyncRouteUIDAllowlisted(route.id, `${user?.uid || ''}`)) {
      continue;
    }

    const summaryRoute: ServiceAutomaticSyncRoute = {
      id: route.id,
      label: buildAutomaticSyncRouteLabel(route.sourceServiceName, route.destinationServiceName),
    };
    summaries[PROVIDER_SECTION_BY_SERVICE[route.sourceServiceName]].routes = [
      ...summaries[PROVIDER_SECTION_BY_SERVICE[route.sourceServiceName]].routes,
      summaryRoute,
    ];
    summaries[PROVIDER_SECTION_BY_SERVICE[route.destinationServiceName]].routes = [
      ...summaries[PROVIDER_SECTION_BY_SERVICE[route.destinationServiceName]].routes,
      summaryRoute,
    ];
  }

  return summaries;
}

@Component({
  selector: 'app-services',
  templateUrl: './services.component.html',
  styleUrls: ['./services.component.scss'],
  standalone: false
})
export class ServicesComponent implements OnInit, OnDestroy {
  @ViewChild('serviceToolsDialog') private serviceToolsDialog?: TemplateRef<unknown>;

  public suuntoAppLinkFormGroup!: UntypedFormGroup;
  public isLoading = false;
  public user!: AppUserInterface;

  public suuntoAppTokens: Auth2ServiceTokenInterface[] = [];
  public activeSection: ServiceSectionId = 'garmin';
  public readonly serviceLabelBySection: Record<ServiceSectionId, string> = {
    garmin: getProviderDisplayName(ServiceNames.GarminAPI, 'source'),
    suunto: getProviderDisplayName(ServiceNames.SuuntoApp, 'source'),
    coros: getProviderDisplayName(ServiceNames.COROSAPI, 'source'),
    wahoo: getProviderDisplayName(ServiceNames.WahooAPI, 'source'),
    mcp: 'MCP',
  };
  public readonly serviceNameByProviderSection: Record<ProviderServiceSectionId, ServiceNames> = {
    garmin: ServiceNames.GarminAPI,
    suunto: ServiceNames.SuuntoApp,
    coros: ServiceNames.COROSAPI,
    wahoo: ServiceNames.WahooAPI,
  };
  public readonly serviceSectionOptions: readonly ServiceSectionOption[] = [
    {
      id: 'garmin',
      href: '/services?serviceName=' + encodeURIComponent(ServiceNames.GarminAPI),
      label: this.serviceLabelBySection.garmin,
      providerId: 'garmin',
      serviceName: ServiceNames.GarminAPI,
      requiresPro: true,
    },
    {
      id: 'suunto',
      href: '/services?serviceName=' + encodeURIComponent(ServiceNames.SuuntoApp),
      label: this.serviceLabelBySection.suunto,
      providerId: 'suunto',
      serviceName: ServiceNames.SuuntoApp,
      requiresPro: true,
    },
    {
      id: 'coros',
      href: '/services?serviceName=' + encodeURIComponent(ServiceNames.COROSAPI),
      label: this.serviceLabelBySection.coros,
      providerId: 'coros',
      serviceName: ServiceNames.COROSAPI,
      requiresPro: true,
    },
    {
      id: 'wahoo',
      href: '/services?serviceName=' + encodeURIComponent(ServiceNames.WahooAPI),
      label: this.serviceLabelBySection.wahoo,
      providerId: 'wahoo',
      serviceName: ServiceNames.WahooAPI,
      requiresPro: true,
    },
    {
      id: 'mcp',
      href: '/services?serviceName=mcp',
      label: this.serviceLabelBySection.mcp,
      providerId: null,
      serviceName: null,
      requiresPro: false,
    },
  ];
  public readonly serviceOverviewCardsBySection: Record<ProviderServiceSectionId, readonly ServiceOverviewCard[]> = {
    garmin: [
      {
        title: 'Import history',
        description: 'Import past activities, sleep and available Health data.',
        icon: 'history',
        actionLabel: 'Choose dates & data',
        tool: 'history',
      },
      {
        title: 'Send route files to Garmin',
        description: 'Send a GPX or FIT route file directly to Garmin Connect as a course without adding it to your Quantified Self route library.',
        icon: 'route',
        actionLabel: 'Send route file',
        tool: 'uploads',
      },
      {
        title: 'Send activities to connected services',
        description: 'Automatically send new Garmin activities to Suunto, Wahoo, or COROS.',
        icon: 'published_with_changes',
        actionLabel: 'Set up automatic sending',
        tool: 'auto-sync',
      },
    ],
    suunto: [
      {
        title: 'Import history',
        description: 'Import past activities, sleep and available 24/7 Health data.',
        icon: 'history',
        actionLabel: 'Choose dates & data',
        tool: 'history',
      },
      {
        title: 'Route sync',
        description: 'Import existing Suunto routes and send saved routes to Garmin, Wahoo, or COROS.',
        icon: 'route',
        actionLabel: 'Set up route sync',
        tool: 'routes',
      },
      {
        title: 'Send activities',
        description: 'Review local FIT files or saved activities and send them to Suunto in the background.',
        icon: 'cloud_upload',
        actionLabel: 'Send activities',
        tool: 'send-activities',
      },
      {
        title: 'Send past activities to Suunto',
        description: 'Choose saved provider imports and manual FIT uploads, preview them, and send a date range to Suunto.',
        icon: 'history',
        actionLabel: 'Send past activities',
        tool: 'historical-send',
      },
      {
        title: 'Send activities to connected services',
        description: 'Automatically send new Suunto activities to Wahoo or COROS.',
        icon: 'published_with_changes',
        actionLabel: 'Set up automatic sending',
        tool: 'activity-sync',
      },
      { title: 'Send route files', description: 'Send GPX or FIT route files to Suunto.', icon: 'route', actionLabel: 'Send route files', tool: 'uploads' },
    ],
    coros: [
      {
        title: 'Import history',
        description: 'Import past activities, sleep and available daily Health data.',
        icon: 'history',
        actionLabel: 'Choose dates & data',
        tool: 'history',
      },
      {
        title: 'Send activities',
        description: 'Send a FIT activity directly to COROS without adding it to your Quantified Self archive.',
        icon: 'send',
        actionLabel: 'Send activities',
        tool: 'send-activities',
      },
      {
        title: 'Send past activities to COROS',
        description: 'Choose saved provider imports and manual FIT uploads, preview them, and send a date range to COROS.',
        icon: 'history',
        actionLabel: 'Send past activities',
        tool: 'historical-send',
      },
      {
        title: 'Send activities to connected services',
        description: 'Automatically send new COROS activities to Suunto or Wahoo.',
        icon: 'published_with_changes',
        actionLabel: 'Set up automatic sending',
        tool: 'auto-sync',
      },
      { title: 'Send route files', description: 'Send GPX or FIT route files to COROS.', icon: 'route', actionLabel: 'Send route files', tool: 'uploads' },
    ],
    wahoo: [
      {
        title: 'Import history',
        description: 'Import past Wahoo-recorded activities.',
        icon: 'history',
        actionLabel: 'Choose dates & data',
        tool: 'history',
      },
      {
        title: 'Send activities',
        description: 'Review local FIT files or saved activities and send them to Wahoo in the background.',
        icon: 'send',
        actionLabel: 'Send activities',
        tool: 'send-activities',
      },
      {
        title: 'Send past activities to Wahoo',
        description: 'Choose saved provider imports and manual FIT uploads, preview them, and send a date range to Wahoo.',
        icon: 'history',
        actionLabel: 'Send past activities',
        tool: 'historical-send',
      },
      {
        title: 'Send activities to connected services',
        description: 'Automatically send new Wahoo activities to Suunto or COROS.',
        icon: 'published_with_changes',
        actionLabel: 'Set up automatic sending',
        tool: 'auto-sync',
      },
      { title: 'Send route files', description: 'Send GPX or FIT route files to Wahoo.', icon: 'route', actionLabel: 'Send route files', tool: 'uploads' },
    ],
  };
  public serviceNames = ServiceNames;
  public hasProAccess = false;
  public isAdmin = false;
  public managedService: ProviderServiceSectionId | null = null;
  public managedTool: ServiceToolId = 'history';
  public managedToolTitle: string | null = null;
  public managedActivitySyncDestination: ServiceDataFlowActivityDestination | null = null;
  public readonly serviceConnectionState: Record<ProviderServiceSectionId, boolean> = {
    garmin: false,
    suunto: false,
    coros: false,
    wahoo: false,
  };
  public automaticSyncSummaryBySection = createEmptyAutomaticSyncSummaryBySection();
  public dataFlowSummary = createEmptyProviderDataFlowSummary();
  public isDataFlowExpanded = false;


  private userSubscription!: Subscription;
  private routeSubscription!: Subscription;
  private serviceToolsDialogRef: MatDialogRef<unknown> | null = null;
  private readonly injector = inject(Injector);
  private requestedHistoryProvider: ProviderServiceSectionId | null = null;
  private historyDetailsRender: AfterRenderRef | null = null;
  private readonly dialog = inject(MatDialog);
  private readonly analyticsService = inject(AppAnalyticsService);
  private readonly paymentService = inject(AppPaymentService);
  private readonly hapticsService = inject(AppHapticsService);
  readonly historyImportProgress = inject(HistoryImportProgressService);
  readonly proOffer = signal<ProMembershipOffer | null>(null);
  private offerReadKey: string | null = null;
  private offerReadSubscription: Subscription | null = null;
  private readonly serviceNameBySection: Record<ProviderServiceSectionId, ServiceNames> = {
    suunto: ServiceNames.SuuntoApp,
    garmin: ServiceNames.GarminAPI,
    coros: ServiceNames.COROSAPI,
    wahoo: ServiceNames.WahooAPI,
  };

  constructor(private http: HttpClient, private fileService: AppFileService,
    private eventService: AppEventService,
    public authService: AppAuthService,
    private router: Router,
    private route: ActivatedRoute,
    private windowService: AppWindowService,
    private snackBar: MatSnackBar) {
  }

  ngOnInit() {
    this.isLoading = true;

    // Use resolver data if available
    const resolvedData = this.route.snapshot.data['userData'];
    if (resolvedData) {
      this.isAdmin = resolvedData.user?.admin === true;
      this.processUser(resolvedData.user, resolvedData.isPro);
      this.isLoading = false;
    }

    this.userSubscription = this.authService.user$.subscribe(user => {
      // user$ already contains verified claims. A separate async access check can
      // finish for an older account or after teardown and restart billing reads.
      this.isAdmin = user?.admin === true;
      if (!this.user || user?.uid !== this.user.uid) {
        this.processUser(user, AppUserUtilities.hasProAccess(user, this.isAdmin));
      } else if (user) {
        this.user = user;
        this.hasProAccess = AppUserUtilities.hasProAccess(user, this.isAdmin);
        this.automaticSyncSummaryBySection = buildAutomaticSyncSummaryBySection(user);
        this.refreshDataFlowSummary();
        this.refreshProOffer();
        this.scheduleHistoryDetails();
      }
    });

    this.routeSubscription = this.route.queryParamMap.subscribe(params => {
      this.activeSection = this.getSectionFromServiceName(params.get('serviceName'));
      this.requestedHistoryProvider = params.get('tool') === 'history'
        ? this.serviceSectionOptions.find(option => option.serviceName === params.get('serviceName'))?.providerId ?? null : null;
      if (this.serviceToolsDialogRef && (this.managedService !== this.activeSection || params.get('reconnect') === '1')) this.serviceToolsDialogRef.close();
      this.refreshProOffer();
      this.scheduleHistoryDetails();
    });
  }

  private scheduleHistoryDetails(): void {
    this.historyDetailsRender?.destroy();
    this.historyDetailsRender = null;
    const provider = this.requestedHistoryProvider, uid = this.user?.uid;
    if (!provider || !uid || !this.hasProAccess) return;
    this.historyDetailsRender = afterNextRender(() => {
      this.historyDetailsRender = null;
      if (this.requestedHistoryProvider !== provider || this.user?.uid !== uid || !this.hasProAccess
        || !this.serviceToolsDialog || this.serviceToolsDialogRef) return;
      this.requestedHistoryProvider = null;
      this.openServiceTools(provider, {tool: 'history', title: 'History import'});
      // Consume the display-only request so closing and following the same link works again.
      void this.router.navigate([], {relativeTo: this.route, queryParams: {tool: null}, queryParamsHandling: 'merge', replaceUrl: true});
    }, {injector: this.injector});
  }

  public openHistoryProgress(section: ProviderServiceSectionId): void {
    if (!this.user?.uid || !this.hasProAccess || this.serviceToolsDialogRef) return;
    this.hapticsService.selection();
    this.openServiceTools(section, {tool: 'history', title: 'History import'});
  }

  async selectService(section: ServiceSectionId) {
    if (section === this.activeSection) return;
    this.activeSection = section;
    this.hapticsService.selection();
    this.refreshProOffer();

    const serviceName = section === 'mcp'
      ? 'mcp'
      : this.serviceNameBySection[section];
    this.analyticsService.logEvent('service_section_selected', {
      section,
      service_name: serviceName,
      access: this.hasProAccess ? 'pro' : 'non_pro',
    });
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { serviceName: serviceName },
      queryParamsHandling: 'merge',
    });
  }

  public onProviderTabClick(event: MouseEvent, section: ServiceSectionId): void {
    // Preserve native open-in-new-tab/window behavior for these real provider links.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void this.selectService(section);
  }

  public openServiceTools(section: ProviderServiceSectionId, toolLaunch: ServiceToolLaunch): void {
    if (section !== 'garmin' && (toolLaunch.tool === 'send-activities' || toolLaunch.tool === 'historical-send')) {
      void this.router.navigate(['/send-activities', section], { queryParams: { source: toolLaunch.tool === 'historical-send' ? 'saved' : 'files' } });
      return;
    }
    if (!this.hasProAccess) {
      this.openProPlans(section, 'capability_card', toolLaunch.tool);
      return;
    }
    if (!this.serviceToolsDialog || this.serviceToolsDialogRef) {
      return;
    }

    this.managedService = section;
    this.managedTool = toolLaunch.tool;
    this.managedToolTitle = toolLaunch.title;
    this.managedActivitySyncDestination = toolLaunch.activitySyncDestination ?? null;
    const dialogRef = this.dialog.open(this.serviceToolsDialog, {
      ariaLabel: `${this.serviceLabelBySection[section]} ${toolLaunch.title} tools`,
      autoFocus: 'dialog',
      maxHeight: 'calc(100dvh - 32px)',
      maxWidth: 'calc(100vw - 32px)',
      restoreFocus: true,
      width: 'min(56rem, calc(100vw - 32px))',
    });
    this.serviceToolsDialogRef = dialogRef;
    dialogRef.afterClosed().subscribe(() => {
      if (this.serviceToolsDialogRef !== dialogRef) {
        return;
      }
      this.serviceToolsDialogRef = null;
      this.managedService = null;
      this.managedTool = 'history';
      this.managedToolTitle = null;
      this.managedActivitySyncDestination = null;
      this.scheduleHistoryDetails();
    });
  }

  public openProPlans(
    section: ProviderServiceSectionId,
    source: 'capability_card' | 'data_flow',
    feature: string,
  ): void {
    this.analyticsService.logEvent('upsell_triggered', {
      service_name: this.serviceNameBySection[section],
      source,
      feature,
    });
    void this.router.navigate(['/subscriptions']);
  }

  public openActiveProviderDataFlowPlans(): void {
    if (this.activeSection === 'mcp') {
      return;
    }
    this.openProPlans(this.activeSection, 'data_flow', 'provider_data_flow');
  }

  public onDataFlowToggle(expanded: boolean): void {
    if (expanded === this.isDataFlowExpanded) return;
    this.isDataFlowExpanded = expanded;
    this.hapticsService.selection();
  }

  private refreshProOffer(): void {
    const key = this.user && !this.hasProAccess ? `${this.user.uid}:${this.user.stripeRole ?? ''}` : null;
    if (!key || key !== this.offerReadKey) {
      this.offerReadSubscription?.unsubscribe();
      this.offerReadSubscription = null;
      this.offerReadKey = null;
      this.proOffer.set(key ? { priceId: null, trialDays: null } : null);
    }
    if (!key || this.activeSection === 'mcp' || key === this.offerReadKey) return;

    this.offerReadKey = key;
    this.proOffer.set({ priceId: null, trialDays: null });
    const role = this.user.stripeRole;
    this.offerReadSubscription = combineLatest([
      this.paymentService.getProducts(),
      from(this.paymentService.hasPaidSubscriptionHistory()).pipe(catchError(() => of(null))),
    ]).pipe(take(1)).subscribe({
      next: ([products, history]) => this.proOffer.set(resolveProMembershipOffer(products, role, history)),
      // Unknown billing data must never advertise a trial or block connection controls.
      error: () => this.proOffer.set({ priceId: null, trialDays: null }),
    });
  }

  public setServiceConnectionState(section: ProviderServiceSectionId, connected: boolean): void {
    this.serviceConnectionState[section] = connected;
    this.refreshDataFlowSummary();
  }

  processUser(user: AppUserInterface | null, isPro: boolean) {
    if (this.user?.uid && this.user.uid !== user?.uid) {
      this.requestedHistoryProvider = null;
      this.historyDetailsRender?.destroy();
      this.serviceToolsDialogRef?.close();
      for (const provider of Object.keys(this.serviceConnectionState) as ProviderServiceSectionId[]) this.serviceConnectionState[provider] = false;
    }
    if (!user) {
      this.user = user;
      this.hasProAccess = false;
      this.isAdmin = false;
      this.refreshProOffer();
      this.automaticSyncSummaryBySection = createEmptyAutomaticSyncSummaryBySection();
      this.dataFlowSummary = createEmptyProviderDataFlowSummary();
      this.isLoading = false;
      this.snackBar.open('You must login if you want to use the service features', 'OK', {
        duration: undefined,
      });
      return;
    }
    this.user = user;
    this.automaticSyncSummaryBySection = buildAutomaticSyncSummaryBySection(user);
    this.refreshDataFlowSummary();

    this.hasProAccess = isPro;

    // Initial check from snapshot if not already set by subscription
    this.activeSection = this.getSectionFromServiceName(this.route.snapshot.queryParamMap.get('serviceName'));
    this.refreshProOffer();
    this.isLoading = false;
    this.scheduleHistoryDetails();
  }

  ngOnDestroy(): void {
    this.requestedHistoryProvider = null;
    this.historyDetailsRender?.destroy();
    this.offerReadSubscription?.unsubscribe();
    this.serviceToolsDialogRef?.close();
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
    }
  }

  private getSectionFromServiceName(serviceName: string | null): ServiceSectionId {
    if (serviceName === 'mcp') {
      return 'mcp';
    }
    if (serviceName === ServiceNames.GarminAPI) {
      return 'garmin';
    }
    if (serviceName === ServiceNames.SuuntoApp) {
      return 'suunto';
    }
    if (serviceName === ServiceNames.COROSAPI) {
      return 'coros';
    }
    if (serviceName === ServiceNames.WahooAPI) {
      return 'wahoo';
    }
    return this.hasProAccess ? 'garmin' : 'mcp';
  }

  private refreshDataFlowSummary(): void {
    this.dataFlowSummary = buildProviderDataFlowSummary({
      uid: `${this.user?.uid || ''}`,
      serviceConnectionState: this.serviceConnectionState,
      activityRouteSettings: this.user?.settings?.serviceSyncSettings?.activitySyncRoutes,
      routeDeliverySettings: this.user?.settings?.serviceSyncSettings?.routeDeliverySyncRoutes,
    });
  }

}
