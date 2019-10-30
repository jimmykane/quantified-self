import { NgModule } from '@angular/core';
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
import {MatExpansionModule} from '@angular/material/expansion';
import {MatButtonModule} from '@angular/material/button';
import {MatButtonToggleModule} from '@angular/material/button-toggle';
import {MatCardModule} from '@angular/material/card';
import {MatIconModule} from '@angular/material/icon';
import {MatCommonModule, MatNativeDateModule} from '@angular/material/core';
import {MatMenuModule} from '@angular/material/menu';
import {MatTabsModule} from '@angular/material/tabs';
import {MatSidenavModule} from '@angular/material/sidenav';
import {MatToolbarModule} from '@angular/material/toolbar';
import {MatGridListModule} from '@angular/material/grid-list';
import {MatTableModule} from '@angular/material/table';
import {CdkTableModule} from '@angular/cdk/table';
import {MatChipsModule} from '@angular/material/chips';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatSliderModule} from '@angular/material/slider';
import {MatSnackBarModule} from '@angular/material/snack-bar';
import {MatInputModule} from '@angular/material/input';
import {MatListModule} from '@angular/material/list';
import {FormsModule} from '@angular/forms';
import {MatProgressBarModule} from '@angular/material/progress-bar';
import {MatSortModule} from '@angular/material/sort';
import {MatTooltipModule} from '@angular/material/tooltip';
import {MatDialogModule} from '@angular/material/dialog';
import {MatSlideToggleModule} from '@angular/material/slide-toggle';
import {MatDatepickerModule} from '@angular/material/datepicker';
import {MatRadioModule} from '@angular/material/radio';
import {MatPaginatorModule} from '@angular/material/paginator';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatSelectModule} from '@angular/material/select';
import {MatBadgeModule} from '@angular/material/badge';
import {MatStepperModule} from '@angular/material/stepper';
import {MatBottomSheetModule} from '@angular/material/bottom-sheet';

@NgModule({
  imports: [],
  exports: [
    MatExpansionModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatIconModule,
    MatCommonModule,
    MatMenuModule,
    MatTabsModule,
    MatSidenavModule,
    MatToolbarModule,
    MatGridListModule,
    MatTableModule,
    MatChipsModule,
    MatCheckboxModule,
    MatSliderModule,
    MatSnackBarModule,
    MatInputModule,
    MatListModule,
    MatProgressBarModule,
    MatTableModule,
    MatSortModule,
    MatTooltipModule,
    MatDialogModule,
    MatSlideToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatRadioModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatBadgeModule,
    MatStepperModule,
    MatBottomSheetModule,
  ],
  declarations: [],
  providers: [
  ]
})


export class MaterialModule { }
