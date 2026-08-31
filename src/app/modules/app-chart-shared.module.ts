import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppLoadingOverlayComponent } from '../components/loading/loading-overlay/loading-overlay.component';
import { AppSkeletonComponent } from '../components/loading/skeleton/app.skeleton.component';
import { ShadeComponent } from '../components/loading/shade.component';
import { HapticTapDirective } from '../directives/haptic-tap.directive';
import { TooltipTapDirective } from '../directives/tooltip-tap.directive';

@NgModule({
  imports: [
    CommonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  declarations: [
    AppLoadingOverlayComponent,
    AppSkeletonComponent,
    ShadeComponent,
    HapticTapDirective,
    TooltipTapDirective,
  ],
  exports: [
    AppLoadingOverlayComponent,
    AppSkeletonComponent,
    ShadeComponent,
    HapticTapDirective,
    TooltipTapDirective,
  ],
})
export class AppChartSharedModule { }
