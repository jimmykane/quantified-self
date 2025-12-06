import {NgModule} from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import {PoliciesComponent} from '../components/policies/policies.component';
import {PoliciesRoutingModule} from '../policies.routing.module';

@NgModule({
    imports: [
        CommonModule,
        SharedModule,
        MaterialModule,
        PoliciesRoutingModule,
    ],
    exports: [],
    declarations: [
        PoliciesComponent
    ]
})


export class PoliciesModule {
}
