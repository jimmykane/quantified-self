import { Component, inject, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { AppFileService } from '../../services/app.file.service';
import { Subscription } from 'rxjs';
import { AppEventService } from '../../services/app.event.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ActivatedRoute, Router } from '@angular/router';
import { AppUserService } from '../../services/app.user.service';
import { AppWindowService } from '../../services/app.window.service';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTES } from '@shared/activity-sync-routes';
import { ROUTE_DELIVERY_SYNC_ROUTES } from '@shared/route-delivery-sync-routes';
import { getProviderDisplayName } from '@shared/provider-presentation';
import { AppUserInterface } from '../../models/app-user.interface';

type ServiceSectionId = 'suunto' | 'garmin' | 'coros' | 'wahoo';
type ServiceToolId = 'history' | 'routes' | 'uploads' | 'auto-sync' | 'activity-sync';

interface ServiceSectionOption {
  id: ServiceSectionId;
  label: string;
  serviceName: ServiceNames;
}

interface ServiceOverviewCard {
  title: string;
  description: string;
  detail: string;
  icon: string;
  actionLabel: string;
  tool: ServiceToolId;
}

interface ServiceAutomaticSyncRoute {
  id: string;
  label: string;
}

interface ServiceAutomaticSyncSummary {
  activities: readonly ServiceAutomaticSyncRoute[];
  routes: readonly ServiceAutomaticSyncRoute[];
}

const SERVICE_SECTION_BY_NAME: Record<ServiceNames, ServiceSectionId> = {
  [ServiceNames.GarminAPI]: 'garmin',
  [ServiceNames.SuuntoApp]: 'suunto',
  [ServiceNames.COROSAPI]: 'coros',
  [ServiceNames.WahooAPI]: 'wahoo',
};

function createEmptyAutomaticSyncSummaryBySection(): Record<ServiceSectionId, ServiceAutomaticSyncSummary> {
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
): Record<ServiceSectionId, ServiceAutomaticSyncSummary> {
  const summaries = createEmptyAutomaticSyncSummaryBySection();
  const serviceSyncSettings = user?.settings?.serviceSyncSettings;
  const activitySettings = serviceSyncSettings?.activitySyncRoutes || {};
  const routeSettings = serviceSyncSettings?.routeDeliverySyncRoutes || {};

  for (const route of Object.values(ACTIVITY_SYNC_ROUTES)) {
    if (activitySettings[route.id]?.enabled !== true) {
      continue;
    }

    const summaryRoute: ServiceAutomaticSyncRoute = {
      id: route.id,
      label: buildAutomaticSyncRouteLabel(route.sourceServiceName, route.destinationServiceName),
    };
    summaries[SERVICE_SECTION_BY_NAME[route.sourceServiceName]].activities = [
      ...summaries[SERVICE_SECTION_BY_NAME[route.sourceServiceName]].activities,
      summaryRoute,
    ];
    summaries[SERVICE_SECTION_BY_NAME[route.destinationServiceName]].activities = [
      ...summaries[SERVICE_SECTION_BY_NAME[route.destinationServiceName]].activities,
      summaryRoute,
    ];
  }

  for (const route of Object.values(ROUTE_DELIVERY_SYNC_ROUTES)) {
    if (routeSettings[route.id]?.enabled !== true) {
      continue;
    }

    const summaryRoute: ServiceAutomaticSyncRoute = {
      id: route.id,
      label: buildAutomaticSyncRouteLabel(route.sourceServiceName, route.destinationServiceName),
    };
    summaries[SERVICE_SECTION_BY_NAME[route.sourceServiceName]].routes = [
      ...summaries[SERVICE_SECTION_BY_NAME[route.sourceServiceName]].routes,
      summaryRoute,
    ];
    summaries[SERVICE_SECTION_BY_NAME[route.destinationServiceName]].routes = [
      ...summaries[SERVICE_SECTION_BY_NAME[route.destinationServiceName]].routes,
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
  };
  public readonly serviceSectionOptions: readonly ServiceSectionOption[] = [
    {
      id: 'garmin',
      label: this.serviceLabelBySection.garmin,
      serviceName: ServiceNames.GarminAPI,
    },
    {
      id: 'suunto',
      label: this.serviceLabelBySection.suunto,
      serviceName: ServiceNames.SuuntoApp,
    },
    {
      id: 'coros',
      label: this.serviceLabelBySection.coros,
      serviceName: ServiceNames.COROSAPI,
    },
    {
      id: 'wahoo',
      label: this.serviceLabelBySection.wahoo,
      serviceName: ServiceNames.WahooAPI,
    },
  ];
  public readonly serviceOverviewCardsBySection: Record<ServiceSectionId, readonly ServiceOverviewCard[]> = {
    garmin: [
      {
        title: 'Activity sync',
        description: 'New Garmin activities import automatically while connected. Backfill earlier activities from History import.',
        detail: 'Automatic sync and activity backfill · Pro',
        icon: 'sync',
        actionLabel: 'Backfill activities',
        tool: 'history',
      },
      {
        title: 'Sleep history',
        description: 'Backfill Garmin sleep data for recovery and sleep insights.',
        detail: 'Historical sleep backfill · 30-day cooldown',
        icon: 'bedtime',
        actionLabel: 'Import sleep history',
        tool: 'history',
      },
      {
        title: 'Send route files to Garmin',
        description: 'Send a GPX or FIT route file directly to Garmin Connect as a course without adding it to your Quantified Self route library.',
        detail: 'Direct GPX and FIT route delivery · Pro',
        icon: 'route',
        actionLabel: 'Send route file',
        tool: 'uploads',
      },
      {
        title: 'Send activities to connected services',
        description: 'Automatically send new Garmin activities to Suunto or Wahoo, or sync past activities by date.',
        detail: 'Automatic and past activity sync',
        icon: 'published_with_changes',
        actionLabel: 'Activity sync settings',
        tool: 'auto-sync',
      },
    ],
    suunto: [
      {
        title: 'Activity sync',
        description: 'New Suunto activities import automatically while connected. Backfill earlier activities from History import.',
        detail: 'Automatic sync and activity backfill · Pro',
        icon: 'sync',
        actionLabel: 'Backfill activities',
        tool: 'history',
      },
      {
        title: 'Sleep history',
        description: 'Backfill Suunto sleep data for recovery and sleep insights.',
        detail: 'Historical sleep backfill · 7-day cooldown',
        icon: 'bedtime',
        actionLabel: 'Import sleep history',
        tool: 'history',
      },
      {
        title: 'Route sync',
        description: 'Import existing Suunto routes and send saved routes to Garmin or Wahoo.',
        detail: 'Route import and automatic delivery',
        icon: 'route',
        actionLabel: 'Route sync settings',
        tool: 'routes',
      },
      {
        title: 'Upload activities and routes',
        description: 'Send FIT activity files or GPX/FIT route files to the Suunto app.',
        detail: 'FIT activity and GPX/FIT route uploads',
        icon: 'cloud_upload',
        actionLabel: 'Upload files',
        tool: 'uploads',
      },
      {
        title: 'Send activities to Wahoo',
        description: 'Automatically send new Suunto activities to Wahoo, or sync past activities by date.',
        detail: 'Automatic and past activity sync',
        icon: 'published_with_changes',
        actionLabel: 'Activity sync settings',
        tool: 'activity-sync',
      },
    ],
    coros: [
      {
        title: 'Activity sync',
        description: 'New COROS activities import automatically while connected.',
        detail: 'History import · Pro',
        icon: 'sync',
        actionLabel: 'History import',
        tool: 'history',
      },
      {
        title: 'Send activities to connected services',
        description: 'Automatically send new COROS activities to Suunto or Wahoo, or sync past activities by date.',
        detail: 'Automatic and past activity sync',
        icon: 'published_with_changes',
        actionLabel: 'Activity sync settings',
        tool: 'auto-sync',
      },
    ],
    wahoo: [
      {
        title: 'Activity sync',
        description: 'New Wahoo activities import automatically while connected.',
        detail: 'History import · Pro',
        icon: 'sync',
        actionLabel: 'History import',
        tool: 'history',
      },
      {
        title: 'Send activity or route files',
        description: 'Send a FIT activity or GPX/FIT course/route directly to Wahoo without adding it to your Quantified Self archive.',
        detail: 'Direct file delivery · Pro',
        icon: 'cloud_upload',
        actionLabel: 'Send files',
        tool: 'uploads',
      },
      {
        title: 'Send activities to Suunto',
        description: 'Automatically send new Wahoo activities to Suunto, or sync past activities by date.',
        detail: 'Automatic and past activity sync',
        icon: 'published_with_changes',
        actionLabel: 'Activity sync settings',
        tool: 'auto-sync',
      },
    ],
  };
  public serviceNames = ServiceNames;
  public hasProAccess = false;
  public isAdmin = false;
  public managedService: ServiceSectionId | null = null;
  public managedTool: ServiceToolId = 'history';
  public managedToolTitle: string | null = null;
  public readonly serviceConnectionState: Record<ServiceSectionId, boolean> = {
    garmin: false,
    suunto: false,
    coros: false,
    wahoo: false,
  };
  public automaticSyncSummaryBySection = createEmptyAutomaticSyncSummaryBySection();


  private userSubscription!: Subscription;
  private routeSubscription!: Subscription;
  private serviceToolsDialogRef: MatDialogRef<unknown> | null = null;
  private readonly dialog = inject(MatDialog);
  private readonly serviceNameBySection: Record<ServiceSectionId, ServiceNames> = {
    suunto: ServiceNames.SuuntoApp,
    garmin: ServiceNames.GarminAPI,
    coros: ServiceNames.COROSAPI,
    wahoo: ServiceNames.WahooAPI,
  };

  constructor(private http: HttpClient, private fileService: AppFileService,
    private eventService: AppEventService,
    public authService: AppAuthService,
    private userService: AppUserService,
    private router: Router,
    private route: ActivatedRoute,
    private windowService: AppWindowService,
    private snackBar: MatSnackBar) {
  }

  async ngOnInit() {
    this.isLoading = true;

    // Use resolver data if available
    const resolvedData = this.route.snapshot.data['userData'];
    if (resolvedData) {
      // isAdmin is not in resolvedData currently, so we fetch it.
      // We could update resolver, but for now let's just fetch it here.
      // We accept that it might "pop" in a millisecond later.
      this.processUser(resolvedData.user, resolvedData.isPro);
      void this.userService.isAdmin()
        .then(isAdmin => {
          this.isAdmin = isAdmin;
          // Re-process to update any dependent logic if necessary (though current processUser doesn't use isAdmin, UI does)
        })
        .catch(() => {
          this.isAdmin = false;
        });
      this.isLoading = false;
    }

    this.userSubscription = this.authService.user$.subscribe((async (user) => {
      // Re-check just in case, or if user changes session while on page (rare but possible)
      // Note: isPro check is async, so we might want to skip it if we just got it from resolver?
      // For simplicity, we can just re-run standard check if it's an update event.
      // But efficiently:
      if (!this.user || user?.uid !== this.user.uid) {
        const isPro = await this.userService.isPro();
        const isAdmin = await this.userService.isAdmin();
        this.isAdmin = isAdmin;
        this.processUser(user, isPro);
      } else if (user) {
        this.user = user;
        this.automaticSyncSummaryBySection = buildAutomaticSyncSummaryBySection(user);
      }
    }));

    this.routeSubscription = this.route.queryParamMap.subscribe(params => {
      this.activeSection = this.getSectionFromServiceName(params.get('serviceName'));
    });
  }

  async selectService(section: ServiceSectionId) {
    this.activeSection = section;

    const serviceName = this.serviceNameBySection[section];
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { serviceName: serviceName },
      queryParamsHandling: 'merge',
    });
  }

  public openServiceTools(section: ServiceSectionId, card: ServiceOverviewCard): void {
    if (!this.serviceToolsDialog || this.serviceToolsDialogRef) {
      return;
    }

    this.managedService = section;
    this.managedTool = card.tool;
    this.managedToolTitle = card.title;
    const dialogRef = this.dialog.open(this.serviceToolsDialog, {
      ariaLabel: `${this.serviceLabelBySection[section]} ${card.title} tools`,
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
    });
  }

  public setServiceConnectionState(section: ServiceSectionId, connected: boolean): void {
    this.serviceConnectionState[section] = connected;
  }

  processUser(user: AppUserInterface | null, isPro: boolean) {
    if (!user) {
      this.automaticSyncSummaryBySection = createEmptyAutomaticSyncSummaryBySection();
      this.isLoading = false;
      this.snackBar.open('You must login if you want to use the service features', 'OK', {
        duration: undefined,
      });
      return;
    }
    this.user = user;
    this.automaticSyncSummaryBySection = buildAutomaticSyncSummaryBySection(user);

    this.hasProAccess = isPro;

    // Initial check from snapshot if not already set by subscription
    this.activeSection = this.getSectionFromServiceName(this.route.snapshot.queryParamMap.get('serviceName'));
    this.isLoading = false;
  }

  ngOnDestroy(): void {
    this.serviceToolsDialogRef?.close();
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
    }
  }

  private getSectionFromServiceName(serviceName: string | null): ServiceSectionId {
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
    return 'garmin';
  }

}
