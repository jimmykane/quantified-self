import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AppFileService } from '../../services/app.file.service';
import { of, Subscription } from 'rxjs';
import { AppEventService } from '../../services/app.event.service';
import { EventImporterFIT } from '@sports-alliance/sports-lib/lib/events/adapters/importers/fit/importer.fit';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { ActivatedRoute, Router } from '@angular/router';
import { AppUserService } from '../../services/app.user.service';
import { switchMap } from 'rxjs/operators';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/meta-data.interface';
import { environment } from '../../../environments/environment';
import { AngularFireAnalytics } from '@angular/fire/analytics';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib/lib/users/user.service.meta.interface';
import { AppWindowService } from '../../services/app.window.service';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib/lib/service-tokens/oauth2-service-token.interface';


@Component({
  selector: 'app-home',
  templateUrl: './services.component.html',
  styleUrls: ['./services.component.css'],
})
export class ServicesComponent implements OnInit, OnDestroy {
  public suuntoAppLinkFormGroup: FormGroup;
  public isLoading = false;
  public user: User;
  public isGuest: boolean;
  public suuntoAppTokens: Auth2ServiceTokenInterface[];
  public metaForService: UserServiceMetaInterface
  private userSubscription: Subscription;

  @HostListener('window:tokensReceived', ['$event'])
  async tokensReceived(event) {
    await this.userService.setSuuntoAppToken(this.user, event.detail.serviceAuthResponse);
    this.isLoading = false;
    this.snackBar.open(`Connected successfully`, null, {
      duration: 2000,
    });
    this.afa.logEvent('connected_to_service', {serviceName: event.detail.serviceName});
  }
  @HostListener('window:authError', ['$event'])
  async authError(event) {
    this.isLoading = false;
    Sentry.captureException(new Error(`Could not connect to Suunto app. Please try another browser or allow popups and cross-site cookies form this site. ERROR: ${event.detail.error}`));
    this.snackBar.open(`Could not connect to Suunto app. Please try another browser or allow popups and cross-site cookies form this site. ERROR: ${event.detail.error}`, null, {
      duration: 10000,
    });
  }

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
        this.snackBar.open('You must login to connect and use the service features', 'OK', {
          duration: null,
        });
        return of(null);
      }
      this.isGuest = this.authService.isGuest();
      if (this.isGuest) {
        this.snackBar.open('You must login with a non-guest account to connect and use the service features', 'OK', {
          duration: 10000,
        });
      }
      return this.userService.getSuuntoAppToken(user)
    })).pipe(switchMap((tokens) => {
      this.suuntoAppTokens = tokens;
      if (!this.user || !this.suuntoAppTokens) {
        return of(null);
      }
      return this.userService
        .getUserMetaForService(this.user, ServiceNames.SuuntoApp)
    })).subscribe(async (metaForService) => {
      this.metaForService = metaForService;

      const state = this.route.snapshot.queryParamMap.get('state');
      const oauthToken = this.route.snapshot.queryParamMap.get('oauth_token');
      const oauthVerifier = this.route.snapshot.queryParamMap.get('oauth_verifier');
      if (state && oauthToken && oauthVerifier){
        try {
          const c = await this.userService.requestAndSetCurrentUserGarminAccessToken(state, oauthVerifier)
        } catch (e) {
          Sentry.captureException(e);
        } finally {
          this.router.navigate(['services'], {preserveQueryParams: false});
        }
      }
      this.isLoading = false;
    });
    this.suuntoAppLinkFormGroup = new FormGroup({
      input: new FormControl('', [
        Validators.required,
        // Validators.minLength(4),
      ]),
    });
  }

  @HostListener('window:resize', ['$event'])
  getColumnsToDisplayDependingOnScreenSize(event?) {
    return window.innerWidth < 600 ? 1 : 2;
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

  connectWithSuuntoApp(event) {
    this.isLoading = true;
    const wnd = window.open('assets/authPopup.html?signInWithService=false', 'name', 'height=585,width=400');
    if (!wnd || wnd.closed || typeof wnd.closed === 'undefined') {
      this.snackBar.open(`Popup has been block by your browser settings. Please disable popup blocking for this site to connect with the Suunto app`, null, {
        duration: 5000,
      });
      Sentry.captureException(new Error(`Could not open popup for signing in with the Suunto app`));
      return
    }
    // wnd.onunload = () => this.isLoading = false;
  }

  async connectWithGarmin(event) {
    try {
      this.isLoading = true;
      const redirectURI = await this.userService.getCurrentUserGarminHealthAPIRedirectURI();
      // Get the redirect url for the unsigned token created with the post
      const tokens = await this.userService.getGarminHealthAPITokens(this.user)
      // this.windowService.windowRef.location.href = 'https://www.google.com'
      this.windowService.windowRef.location.href = `${redirectURI.redirect_url}?oauth_token=${tokens.oauthToken}&oauth_callback=${encodeURI(`${this.windowService.currentDomain}/services?state=${tokens.state}`)}`
    } catch (e){
      Sentry.captureException(e);
    } finally {
      this.isLoading = false;
    }
  }

  async deauthorizeSuuntoApp(event) {
    this.isLoading = true;
    try {
      await this.userService.deauthorizeSuuntoAppService();
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

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }
}
