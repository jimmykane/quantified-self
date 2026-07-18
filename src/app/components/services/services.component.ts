import { Component, inject, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { AppFileService } from '../../services/app.file.service';
import { Subscription } from 'rxjs';
import { AppEventService } from '../../services/app.event.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib';
import { ActivatedRoute, Router } from '@angular/router';
import { AppUserService } from '../../services/app.user.service';
import { AppWindowService } from '../../services/app.window.service';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getProviderDisplayName } from '@shared/provider-presentation';

type ServiceSectionId = 'suunto' | 'garmin' | 'coros';
type ServiceToolId = 'history' | 'routes' | 'uploads' | 'auto-sync';

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
  public user!: User;

  public suuntoAppTokens: Auth2ServiceTokenInterface[] = [];
  public activeSection: ServiceSectionId = 'garmin';
  public readonly sectionOrder: ServiceSectionId[] = ['garmin', 'suunto', 'coros'];
  public readonly serviceLabelBySection: Record<ServiceSectionId, string> = {
    garmin: getProviderDisplayName(ServiceNames.GarminAPI, 'source'),
    suunto: getProviderDisplayName(ServiceNames.SuuntoApp, 'source'),
    coros: getProviderDisplayName(ServiceNames.COROSAPI, 'source'),
  };
  public readonly serviceSectionOptions: ServiceSectionOption[] = [
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
  ];
  public readonly serviceOverviewCardsBySection: Record<ServiceSectionId, readonly ServiceOverviewCard[]> = {
    garmin: [
      {
        title: 'Activity sync',
        description: 'New Garmin activities import automatically while connected.',
        detail: 'History import · Pro',
        icon: 'sync',
        actionLabel: 'History import',
        tool: 'history',
      },
      {
        title: 'Send activities to Suunto',
        description: 'Automatically send new Garmin activities to Suunto, or sync past activities by date.',
        detail: 'Automatic and past activity sync',
        icon: 'published_with_changes',
        actionLabel: 'Activity sync settings',
        tool: 'auto-sync',
      },
    ],
    suunto: [
      {
        title: 'Activity sync',
        description: 'New Suunto activities import automatically while connected.',
        detail: 'History import · Pro',
        icon: 'sync',
        actionLabel: 'History import',
        tool: 'history',
      },
      {
        title: 'Routes & uploads',
        description: 'Import routes and send FIT or GPX files to Suunto.',
        detail: 'Route sync and upload controls',
        icon: 'route',
        actionLabel: 'Routes & uploads',
        tool: 'routes',
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
        title: 'Send activities to Suunto',
        description: 'Automatically send new COROS activities to Suunto, or sync past activities by date.',
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
  };


  private userSubscription!: Subscription;
  private routeSubscription!: Subscription;
  private serviceToolsDialogRef: MatDialogRef<unknown> | null = null;
  private readonly dialog = inject(MatDialog);
  private readonly serviceNameBySection: Record<ServiceSectionId, ServiceNames> = {
    suunto: ServiceNames.SuuntoApp,
    garmin: ServiceNames.GarminAPI,
    coros: ServiceNames.COROSAPI,
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
      if (!this.user || (user && user.uid !== this.user.uid)) {
        const isPro = await this.userService.isPro();
        const isAdmin = await this.userService.isAdmin();
        this.isAdmin = isAdmin;
        this.processUser(user, isPro);
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

  processUser(user: User | null, isPro: boolean) {
    if (!user) {
      this.isLoading = false;
      this.snackBar.open('You must login if you want to use the service features', 'OK', {
        duration: undefined,
      });
      return
    }
    this.user = user;

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
    return 'garmin';
  }
}
