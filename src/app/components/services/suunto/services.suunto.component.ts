import { Component, OnInit } from '@angular/core';
import { UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, ActivatedRoute } from '@angular/router';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { LoggerService } from '../../../services/logger.service';
import { AppFileService } from '../../../services/app.file.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { environment } from '../../../../environments/environment';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';


@Component({
  selector: 'app-services-suunto',
  templateUrl: './services.suunto.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.suunto.component.css'],
  standalone: false
})
export class ServicesSuuntoComponent extends ServicesAbstractComponentDirective implements OnInit {
  public suuntoAppLinkFormGroup: UntypedFormGroup;

  public serviceName = ServiceNames.SuuntoApp;
  public isDownloading = false;
  public isImporting = false;
  clicks = 0;

  constructor(protected http: HttpClient,
    protected fileService: AppFileService,
    protected analytics: Analytics,
    protected eventService: AppEventService,
    protected authService: AppAuthService,
    protected userService: AppUserService,
    protected router: Router,
    protected route: ActivatedRoute,
    protected windowService: AppWindowService,
    protected snackBar: MatSnackBar,
    protected logger: LoggerService) {
    super(http, fileService, analytics, eventService, authService, userService, router, route, windowService, snackBar, logger);
  }

  isConnectedToService(): boolean {
    return !!this.serviceTokens && !!this.serviceTokens.length
  }

  buildRedirectURIFromServiceToken(token: { redirect_uri: string }): string {
    return token.redirect_uri
  }

  async requestAndSetToken() {
    const state = this.route.snapshot.queryParamMap.get('state');
    const code = this.route.snapshot.queryParamMap.get('code');
    if (state && code) {
      await this.userService.requestAndSetCurrentUserSuuntoAppAccessToken(state, code);
    }
  }

  async ngOnInit() {
    this.suuntoAppLinkFormGroup = new UntypedFormGroup({
      input: new UntypedFormControl('', [
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

    if (this.isDownloading || this.isImporting) {
      return false;
    }

    if (shouldImportAndOpen) {
      this.isImporting = true;
    } else {
      this.isDownloading = true;
    }

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
        logEvent(this.analytics, 'downloaded_fit_file', { method: ServiceNames.SuuntoApp });
      } else {
        const newEvent = await EventImporterFIT.getFromArrayBuffer(result);
        await this.eventService.writeAllEventData(this.user, newEvent, {
          data: result,
          extension: 'fit',
          startDate: newEvent.startDate
        });
        logEvent(this.analytics, 'imported_fit_file', { method: ServiceNames.SuuntoApp });
        await this.router.navigate(['/user', this.user.uid, 'event', newEvent.getID()], {});
      }
    } catch (e) {
      this.snackBar.open('Could not open activity. Make sure that the activity is public by opening the link in a new browser tab', null, {
        duration: 5000,
      });
      this.logger.error(e);
    } finally {
      this.isDownloading = false;
      this.isImporting = false;
    }
  }

  validateAllFormFields(formGroup: UntypedFormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof UntypedFormControl) {
        control.markAsTouched({ onlySelf: true });
      } else if (control instanceof UntypedFormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }
}
