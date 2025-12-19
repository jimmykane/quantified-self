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
  styleUrls: ['./services.component.css'],
  standalone: false
})
export class ServicesComponent implements OnInit, OnDestroy {
  public suuntoAppLinkFormGroup: UntypedFormGroup;
  public isLoading = false;
  public user: User;
  public isGuest: boolean;
  public suuntoAppTokens: Auth2ServiceTokenInterface[];
  public selectedTabIndex = 0;
  public serviceNames = ServiceNames;
  public hasProAccess = false;

  private userSubscription: Subscription;

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
      this.user = user;
      if (!user) {
        this.isLoading = false;
        this.snackBar.open('You must login if you want to use the service features', 'OK', {
          duration: null,
        });
        return
      }
      this.isGuest = !!(user as any)?.isAnonymous;
      if (this.isGuest) {
        this.isLoading = false;
        this.snackBar.open('You must login with a non-guest account if you want to use the service features', 'OK', {
          duration: null,
        });
        return;
      }

      // Check for Pro Role via Claims (Force Refresh)
      this.hasProAccess = await this.userService.isPro();

      const indexMap = {
        [ServiceNames.SuuntoApp]: 0,
        [ServiceNames.GarminHealthAPI]: 1,
        [ServiceNames.COROSAPI]: 2,
      }
      this.selectedTabIndex = indexMap[this.route.snapshot.queryParamMap.get('serviceName')] || 0;
      this.isLoading = false;
    }))

  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }
}
