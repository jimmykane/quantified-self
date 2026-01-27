import { Component, OnDestroy, OnInit } from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
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


@Component({
  selector: 'app-services',
  templateUrl: './services.component.html',
  styleUrls: ['./services.component.scss'],
  standalone: false
})
export class ServicesComponent implements OnInit, OnDestroy {
  public suuntoAppLinkFormGroup!: UntypedFormGroup;
  public isLoading = false;
  public user!: User;

  public suuntoAppTokens: Auth2ServiceTokenInterface[] = [];
  public activeSection: 'suunto' | 'garmin' | 'coros' = 'suunto';
  public serviceNames = ServiceNames;
  public hasProAccess = false;
  public isAdmin = false;
  public isGuest = false;

  private userSubscription!: Subscription;
  private routeSubscription!: Subscription;

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
      this.userService.isAdmin().then(isAdmin => {
        this.isAdmin = isAdmin;
        // Re-process to update any dependent logic if necessary (though current processUser doesn't use isAdmin, UI does)
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
      const serviceNameParam = params.get('serviceName');
      if (serviceNameParam === ServiceNames.GarminAPI) {
        this.activeSection = 'garmin';
      } else if (serviceNameParam === ServiceNames.COROSAPI) {
        this.activeSection = 'coros';
      } else {
        this.activeSection = 'suunto';
      }
    });
  }

  async selectService(section: 'suunto' | 'garmin' | 'coros') {
    let serviceName: string;
    switch (section) {
      case 'garmin':
        serviceName = ServiceNames.GarminAPI;
        break;
      case 'coros':
        serviceName = ServiceNames.COROSAPI;
        break;
      default:
        serviceName = ServiceNames.SuuntoApp;
        break;
    }
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { serviceName: serviceName },
      queryParamsHandling: 'merge',
    });
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
    const serviceNameParam = this.route.snapshot.queryParamMap.get('serviceName');
    if (serviceNameParam === ServiceNames.GarminAPI) {
      this.activeSection = 'garmin';
    } else if (serviceNameParam === ServiceNames.COROSAPI) {
      this.activeSection = 'coros';
    } else {
      this.activeSection = 'suunto';
    }
    this.isLoading = false;
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
    }
  }
}
