import { Component, HostListener, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AppFileService } from '../../services/app.file.service';
import { combineLatest, of, Subscription } from 'rxjs';
import { AppEventService } from '../../services/app.event.service';
import { EventImporterFIT } from '@sports-alliance/sports-lib/lib/events/adapters/importers/fit/importer.fit';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { ActivatedRoute, Router } from '@angular/router';
import { AppUserService } from '../../services/app.user.service';
import { switchMap, take, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AngularFireAnalytics } from '@angular/fire/analytics';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib/lib/users/user.service.meta.interface';
import { AppWindowService } from '../../services/app.window.service';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib/lib/service-tokens/oauth2-service-token.interface';
import { Auth1ServiceTokenInterface } from '@sports-alliance/sports-lib/lib/service-tokens/oauth1-service-token.interface';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';


@Component({
  selector: 'app-services',
  templateUrl: './services.component.html',
  styleUrls: ['./services.component.css'],
})
export class ServicesComponent implements OnInit, OnDestroy {
  public suuntoAppLinkFormGroup: FormGroup;
  public isLoading = false;
  public user: User;
  public isGuest: boolean;
  public suuntoAppTokens: Auth2ServiceTokenInterface[];
  public garminHealthAPIToken: Auth1ServiceTokenInterface;
  public suuntoAppMeta: UserServiceMetaInterface
  public selectedTabIndex = 0;
  public serviceNames = ServiceNames;

  private userSubscription: Subscription;

  constructor(private http: HttpClient, private fileService: AppFileService,
              private afa: AngularFireAnalytics,
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
    this.userSubscription = this.authService.user.pipe(switchMap((user) => {
      this.user = user;
      if (!this.user) {
        this.snackBar.open('You must login if you want to use the service features', 'OK', {
          duration: null,
        });
        return of(null);
      }
      this.isGuest = this.authService.isGuest();
      if (this.isGuest) {
        this.snackBar.open('You must login with a non-guest account if you want to use the service features', 'OK', {
          duration: null,
        });
        return of(null);
      }
      return combineLatest([
        this.userService.getServiceToken(this.user, ServiceNames.SuuntoApp),
        this.userService.getServiceToken(this.user, ServiceNames.GarminHealthAPI),
        this.userService
          .getUserMetaForService(this.user, ServiceNames.SuuntoApp),
      ])
    })).pipe(tap((results) => {
      if (!results){
        this.suuntoAppTokens = null;
        this.garminHealthAPIToken = null;
        this.suuntoAppMeta = null;
        return;
      }
      this.suuntoAppTokens = results[0];
      this.garminHealthAPIToken = results[1];
      this.suuntoAppMeta = results[2];
    })).subscribe(async (results) => {
      const serviceName = this.route.snapshot.queryParamMap.get('serviceName');
      const state = this.route.snapshot.queryParamMap.get('state');
      const oauthToken = this.route.snapshot.queryParamMap.get('oauth_token');
      const oauthVerifier = this.route.snapshot.queryParamMap.get('oauth_verifier');
      const code = this.route.snapshot.queryParamMap.get('code');
      if (!serviceName) {
        this.isLoading = false;
        return;
      }
      try {
        switch (serviceName) {
          default:
            throw new Error(`Not implemented for service name ${serviceName}`);
            break;
          case ServiceNames.SuuntoApp:
            if (state && code) {
              this.selectedTabIndex = 0;
              await this.userService.requestAndSetCurrentUserSuuntoAppAccessToken(state, code);
              this.afa.logEvent('connected_to_service', {serviceName: ServiceNames.SuuntoApp});
              this.snackBar.open(`Successfully connected to ${ServiceNames.SuuntoApp}`, null, {
                duration: 10000,
              });
            }
            break;
          case ServiceNames.GarminHealthAPI:
            if (state && oauthToken && oauthVerifier) {
              this.selectedTabIndex = 1;
              await this.userService.requestAndSetCurrentUserGarminAccessToken(state, oauthVerifier);
              this.afa.logEvent('connected_to_service', {serviceName: ServiceNames.GarminHealthAPI});
              this.snackBar.open(`Successfully connected to ${ServiceNames.GarminHealthAPI}`, null, {
                duration: 10000,
              });
            }
            break;
        }
      } catch (e) {
        Sentry.captureException(e);
        this.snackBar.open(`Could not connect due to ${e}`, null, {
          duration: 10000,
        });
      } finally {
        this.isLoading = false;
        await this.router.navigate(['services'], {preserveQueryParams: false});
      }
    });
    this.suuntoAppLinkFormGroup = new FormGroup({
      input: new FormControl('', [
        Validators.required,
        // Validators.minLength(4),
      ]),
    });
  }

  hasError(field: string) {
    return !(this.suuntoAppLinkFormGroup.get(field).valid && this.suuntoAppLinkFormGroup.get(field).touched);
  }

  async onImportAndOpen() {
    return this.onSubmit(true);
  }

  async onSubmit(shouldImportAndOpen?: boolean) {
    if (!this.suuntoAppLinkFormGroup.valid) {
      this.validateAllFormFields(this.suuntoAppLinkFormGroup);
      return;
    }

    if (this.isLoading) {
      return false;
    }

    this.isLoading = true;

    try {

      const parts = this.suuntoAppLinkFormGroup.get('input').value.split('?')[0].split('/');
      const activityID = parts[parts.length - 1] === '' ? parts[parts.length - 2] : parts[parts.length - 1];

      const result = await this.http.get(
        environment.functions.stWorkoutDownloadAsFit, {
          params: {
            activityID: activityID
          },
          responseType: 'arraybuffer',
        }).toPromise();

      if (!shouldImportAndOpen) {
        this.fileService.downloadFile(new Blob([new Uint8Array(result)]), activityID, 'fit');
        // .subscribe(response => this.downLoadFile(response, "application/ms-excel"));
        this.snackBar.open('Activity download started', null, {
          duration: 2000,
        });
        this.afa.logEvent('downloaded_fit_file', {method: ServiceNames.SuuntoApp});
      } else {
        const newEvent = await EventImporterFIT.getFromArrayBuffer(result);
        await this.eventService.writeAllEventData(this.user, newEvent);
        this.afa.logEvent('imported_fit_file', {method: ServiceNames.SuuntoApp});
        await this.router.navigate(['/user', this.user.uid, 'event', newEvent.getID()], {});
      }
    } catch (e) {
      this.snackBar.open('Could not open activity. Make sure that the activity is public by opening the link in a new browser tab', null, {
        duration: 5000,
      });
      Sentry.captureException(e);
    } finally {
      this.isLoading = false;
    }
  }

  validateAllFormFields(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof FormControl) {
        control.markAsTouched({onlySelf: true});
      } else if (control instanceof FormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }

  async connectWithSuuntoApp(event) {
    try {
      this.isLoading = true;
      const tokenAndURI = await this.userService.getCurrentUserServiceTokenAndRedirectURI(ServiceNames.SuuntoApp);
      // Get the redirect url for the unsigned token created with the post
      this.windowService.windowRef.location.href = `${tokenAndURI.redirect_uri}&redirect_uri=${encodeURIComponent(`${this.windowService.currentDomain}/services?serviceName=${ServiceNames.SuuntoApp}`)}`
    } catch (e){
      Sentry.captureException(e);
      this.snackBar.open(`Could not connect to ${ServiceNames.SuuntoApp} due to ${e.message}`, null, {
        duration: 5000,
      });
    } finally {
      this.isLoading = false;
    }
  }

  async connectWithGarmin(event) {
    try {
      this.isLoading = true;
      const tokenAndURI = <{redirect_uri: string, state: string, oauthToken: string}>(await this.userService.getCurrentUserServiceTokenAndRedirectURI(ServiceNames.GarminHealthAPI));
      // Get the redirect url for the unsigned token created with the post
      this.windowService.windowRef.location.href = `${tokenAndURI.redirect_uri}?oauth_token=${tokenAndURI.oauthToken}&oauth_callback=${encodeURIComponent(`${this.windowService.currentDomain}/services?state=${tokenAndURI.state}&serviceName=${ServiceNames.GarminHealthAPI}`)}`
    } catch (e) {
      Sentry.captureException(e);
      this.snackBar.open(`Could not connect to  ${ServiceNames.GarminHealthAPI} due to ${e.message}`, null, {
        duration: 5000,
      });
    } finally {
      this.isLoading = false;
    }
  }

  async deauthorizeSuuntoApp(event) {
    this.isLoading = true;
    try {
      await this.userService.deauthorizeService(ServiceNames.SuuntoApp);
      this.snackBar.open(`Disconnected successfully`, null, {
        duration: 2000,
      });
      this.afa.logEvent('disconnected_from_service', {serviceName: ServiceNames.SuuntoApp});
    } catch (e) {
      Sentry.captureException(e);
      this.snackBar.open(`Could not disconnect due to ${e.message}`, null, {
        duration: 2000,
      });
    }
    this.isLoading = false;
  }

  async deauthorizeGarminHealthAPI(event) {
    this.isLoading = true;
    try {
      await this.userService.deauthorizeService(ServiceNames.GarminHealthAPI);
      this.garminHealthAPIToken = null
      this.snackBar.open(`Disconnected successfully`, null, {
        duration: 2000,
      });
      this.afa.logEvent('disconnected_from_service', {serviceName: ServiceNames.GarminHealthAPI});
    } catch (e) {
      Sentry.captureException(e);
      this.snackBar.open(`Could not disconnect due to ${e.message}`, null, {
        duration: 2000,
      });
    } finally {
      this.isLoading = false;
    }
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }
}
