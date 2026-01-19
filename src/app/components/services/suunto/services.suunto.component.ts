import { Component, OnInit } from '@angular/core';
import { UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, ActivatedRoute } from '@angular/router';
import { LoggerService } from '../../../services/logger.service';
import { AppFileService } from '../../../services/app.file.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { EventImporterFIT, ActivityParsingOptions } from '@sports-alliance/sports-lib';
import { environment } from '../../../../environments/environment';
import { ServiceNames, Auth2ServiceTokenInterface, Auth1ServiceTokenInterface, UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';
import { AppFunctionsService } from '../../../services/app.functions.service';


@Component({
  selector: 'app-services-suunto',
  templateUrl: './services.suunto.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.suunto.component.css'],
  standalone: false
})
export class ServicesSuuntoComponent extends ServicesAbstractComponentDirective implements OnInit {
  public suuntoAppLinkFormGroup!: UntypedFormGroup;

  public serviceName = ServiceNames.SuuntoApp;
  public isDownloading = false;
  public isImporting = false;
  clicks = 0;

  get suuntoServiceMeta(): UserServiceMetaInterface & { uploadedActivitiesCount?: number } | undefined {
    return this.serviceMeta;
  }

  constructor(protected http: HttpClient,
    protected fileService: AppFileService,
    protected eventService: AppEventService,
    protected authService: AppAuthService,
    protected userService: AppUserService,
    protected route: ActivatedRoute,
    protected windowService: AppWindowService,
    protected snackBar: MatSnackBar,
    protected functionsService: AppFunctionsService) {
    super(http, fileService, eventService, authService, userService, route, windowService, snackBar);
  }

  isConnectedToService(): boolean {
    return (!!this.serviceTokens && !!this.serviceTokens.length) || this.forceConnected;
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
    return !(this.suuntoAppLinkFormGroup.get(field)?.valid && this.suuntoAppLinkFormGroup.get(field)?.touched);
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

      const parts = this.suuntoAppLinkFormGroup.get('input')?.value.split('?')[0].split('/');
      const activityID = parts[parts.length - 1] === '' ? parts[parts.length - 2] : parts[parts.length - 1];

      const functionResult = await this.functionsService.call<{ activityID: string }, { file: string }>('stWorkoutDownloadAsFit', {
        activityID: activityID
      });

      if (!functionResult.data || !functionResult.data.file) {
        throw new Error('No data received');
      }

      // Decode Base64 to ArrayBuffer
      const binaryString = atob(functionResult.data.file);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const result = bytes.buffer;

      if (!shouldImportAndOpen) {
        this.fileService.downloadFile(new Blob([new Uint8Array(result)]), activityID, 'fit');
        // .subscribe(response => this.downLoadFile(response, "application/ms-excel"));
        this.snackBar.open('Activity download started', undefined, {
          duration: 2000,
        });
        this.analyticsService.logEvent('downloaded_fit_file', { method: ServiceNames.SuuntoApp });
      } else {
        const newEvent = await EventImporterFIT.getFromArrayBuffer(result, new ActivityParsingOptions({
          generateUnitStreams: false
        }));
        await this.eventService.writeAllEventData(this.user, newEvent, {
          data: result,
          extension: 'fit',
          startDate: newEvent.startDate
        });
        this.analyticsService.logEvent('imported_fit_file', { method: ServiceNames.SuuntoApp });
        await this.router.navigate(['/user', this.user.uid, 'event', newEvent.getID()], {});
      }
    } catch (e) {
      this.snackBar.open('Could not open activity. Make sure that the activity is public by opening the link in a new browser tab', undefined, {
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

  get suuntoUserName(): string | undefined {
    return (this.serviceTokens as Auth2ServiceTokenInterface[])?.[0]?.userName;
  }

  getSuuntoUserName(token: Auth1ServiceTokenInterface | Auth2ServiceTokenInterface): string | undefined {
    return (token as Auth2ServiceTokenInterface).userName;
  }
}
