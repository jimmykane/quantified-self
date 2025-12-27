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
  public isGuest = false;
  public suuntoAppTokens: Auth2ServiceTokenInterface[] = [];
  public activeSection: 'suunto' | 'garmin' | 'coros' = 'suunto';
  public serviceNames = ServiceNames;
  public hasProAccess = false;

  private userSubscription!: Subscription;

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
    this.userSubscription = this.authService.user$.subscribe((async (user) => {
      if (!user) {
        this.isLoading = false;
        this.snackBar.open('You must login if you want to use the service features', 'OK', {
          duration: undefined,
        });
        return
      }
      this.user = user;
      this.isGuest = !!(user as any)?.isAnonymous;
      if (this.isGuest) {
        this.isLoading = false;
        this.snackBar.open('You must login with a non-guest account if you want to use the service features', 'OK', {
          duration: undefined,
        });
        return;
      }

      // Check for Pro Role via Claims (Force Refresh)
      this.hasProAccess = await this.userService.isPro();

      const serviceNameParam = this.route.snapshot.queryParamMap.get('serviceName');
      if (serviceNameParam === ServiceNames.GarminHealthAPI) {
        this.activeSection = 'garmin';
      } else if (serviceNameParam === ServiceNames.COROSAPI) {
        this.activeSection = 'coros';
      } else {
        this.activeSection = 'suunto';
      }
      this.isLoading = false;
    }))

  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }
}
