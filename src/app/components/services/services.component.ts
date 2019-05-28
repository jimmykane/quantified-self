import {Component, HostListener, OnDestroy, OnInit} from '@angular/core';
import {FormControl, FormGroup, Validators} from '@angular/forms';
import {MatSnackBar} from '@angular/material';
import * as Raven from 'raven-js';
import {HttpClient} from '@angular/common/http';
import {FileService} from '../../services/app.file.service';
import {AngularFireFunctions} from '@angular/fire/functions';
import {combineLatest, of, Subscription} from 'rxjs';
import {EventService} from '../../services/app.event.service';
import {EventImporterFIT} from 'quantified-self-lib/lib/events/adapters/importers/fit/importer.fit';
import {AppAuthService} from '../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {Router} from '@angular/router';
import {UserService} from '../../services/app.user.service';
import {switchMap} from 'rxjs/operators';
import {ServiceTokenInterface} from 'quantified-self-lib/lib/service-tokens/service-token.interface';
import {ServiceNames} from "quantified-self-lib/lib/meta-data/meta-data.interface";

declare function require(moduleName: string): any;

const {version: appVersion} = require('../../../../package.json');


@Component({
  selector: 'app-home',
  templateUrl: './services.component.html',
  styleUrls: ['./services.component.css'],
})
export class ServicesComponent implements OnInit, OnDestroy {
  public appVersion = appVersion;
  public eventFormGroup: FormGroup;
  public isLoading = false;
  public user: User;
  public serviceTokens: ServiceTokenInterface[];
  private userSubscription: Subscription;


  @HostListener('window:tokensReceived', ['$event'])
  async tokensReceived(event) {
    await this.userService.setServiceAuthToken(this.user, event.detail.serviceName, event.detail.serviceAuthResponse)
    this.isLoading = false;
    this.snackBar.open(`Connected successfully`, null, {
      duration: 2000,
    });
  }

  constructor(private http: HttpClient, private fileService: FileService,
              private fns: AngularFireFunctions,
              private eventService: EventService,
              public authService: AppAuthService,
              private userService: UserService,
              private router: Router,
              private snackBar: MatSnackBar) {
  }

  ngOnInit(): void {
    this.userSubscription = this.authService.user.pipe(switchMap((user) => {
      if (!user) {
        return of(null);
      }
      this.user = user;
      if (this.authService.isCurrentUserAnonymous()){
        return of(null);
      }
      return this.userService.getServiceAuthToken(user, ServiceNames.SuuntoApp)
    })).subscribe((tokens) => {
      this.serviceTokens = tokens;
    });
    this.eventFormGroup = new FormGroup({
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
    return !(this.eventFormGroup.get(field).valid && this.eventFormGroup.get(field).touched);
  }

  async onImportAndOpen() {
    return this.onSubmit(true);
  }

  async onSubmit(shouldImportAndOpen?: boolean) {
    if (!this.eventFormGroup.valid) {
      this.validateAllFormFields(this.eventFormGroup);
      return;
    }

    if (this.isLoading) {
      return false;
    }

    this.isLoading = true;

    try {

      const parts = this.eventFormGroup.get('input').value.split('?')[0].split('/');
      const activityID = parts[parts.length - 1] === '' ? parts[parts.length - 2] : parts[parts.length - 1];

      const result = await this.http.get(
        `https://europe-west2-quantified-self-io.cloudfunctions.net/stWorkoutDownLoadAsFit`, {
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
      } else {
        const newEvent = await EventImporterFIT.getFromArrayBuffer(result);
        await this.eventService.setEvent(this.user, newEvent);
        await this.router.navigate(['/user', this.user.uid, 'event', newEvent.getID()], {});
      }
    } catch (e) {
      this.snackBar.open('Could not open activity. Make sure that the activity is public by opening the link in a new browser tab', null, {
        duration: 5000,
      });
      Raven.captureException(e);
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
    wnd.onunload = () => this.isLoading = false;
  }

  isConnectedToSuuntoApp() {
    return !!this.serviceTokens.length;
  }
  async deauthorizeSuuntoApp(event) {
    this.isLoading = true;
    try {
      await this.userService.deauthorizeSuuntoAppService();
      this.snackBar.open(`Disconnected successfully`, null, {
        duration: 2000,
      });
    } catch (e) {
      this.snackBar.open(`Could not disconnect due to ${e}`, null, {
        duration: 2000,
      });
    }
    this.isLoading = false;
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
  }
}
