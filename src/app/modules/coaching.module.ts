import {NgModule} from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import { CoachingRoutingModule } from '../coaching.routing.module';
import { AthletesComponent } from '../components/athletes/athletes.component';

@NgModule({
    imports: [
        CommonModule,
        SharedModule,
        MaterialModule,
        CoachingRoutingModule,
    ],
    exports: [],
    declarations: [
        AthletesComponent
    ]
})


export class CoachingModule {
}
