import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from './shared.module';
import { MaterialModule } from './material.module';
import { BenchmarkSelectionDialogComponent } from '../components/benchmark/benchmark-selection-dialog.component';
import { BenchmarkReportComponent } from '../components/benchmark/benchmark-report.component';
import { BenchmarkBottomSheetComponent } from '../components/benchmark/benchmark-bottom-sheet.component';

@NgModule({
    imports: [
        CommonModule,
        SharedModule,
        MaterialModule,
    ],
    declarations: [
        BenchmarkSelectionDialogComponent,
        BenchmarkReportComponent,
        BenchmarkBottomSheetComponent,
    ],
})
export class BenchmarkModule { }
