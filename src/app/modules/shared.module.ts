import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import {ShadeComponent} from '../components/loading/shade.component';
import {MaterialModule} from './material.module';
import {AppAuthService} from '../authentication/app.auth.service';
import {AppAuthGuard} from '../authentication/app.auth.guard';
import {MapSettingsLocalStorageService} from '../services/storage/app.map.settings.local.storage.service';
import {ChartSettingsLocalStorageService} from '../services/storage/app.chart.settings.local.storage.service';
import {UserSettingsService} from '../services/app.user.settings.service';
import {EventService} from '../services/app.event.service';
import {ActionButtonService} from '../services/action-buttons/app.action-button.service';
import {EventColorService} from '../services/color/app.event.color.service';
import {ClipboardService} from '../services/app.clipboard.service';
import {SharingService} from '../services/app.sharing.service';
import {FileService} from '../services/app.file.service';
import {UserService} from '../services/app.user.service';
import {SideNavService} from '../services/side-nav/side-nav.service';
import {ThemeService} from '../services/app.theme.service';
import {AppInfoService} from '../services/app.info.service';
import {WindowService} from '../services/app.window.service';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';



@NgModule({
  imports: [
    CommonModule,
    MaterialModule
  ],

  declarations: [ShadeComponent],
  providers: [
    AppAuthService,
    AppAuthGuard,
    MapSettingsLocalStorageService,
    ChartSettingsLocalStorageService,
    UserSettingsService,
    EventService,
    ActionButtonService,
    EventColorService,
    ClipboardService,
    SharingService,
    FileService,
    UserService,
    SideNavService,
    ThemeService,
    AppInfoService,
    WindowService,
  ],
  exports: [ShadeComponent,
    ReactiveFormsModule,
    FormsModule]
})
export class SharedModule { }
