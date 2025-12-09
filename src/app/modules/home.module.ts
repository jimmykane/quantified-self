import {NgModule} from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import { HomeRoutingModule } from '../home.routing.module';
import { HomeComponent } from '../components/home/home.component';
import { HomeLiveChartComponent } from '../components/home/live-chart/home.live-chart.component';

@NgModule({
    imports: [
        CommonModule,
        SharedModule,
        MaterialModule,
        HomeRoutingModule,
    ],
    exports: [],
    declarations: [
        HomeComponent,
        HomeLiveChartComponent,
    ]
})


export class HomeModule {
}
