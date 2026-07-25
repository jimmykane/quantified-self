import { NgModule } from '@angular/core';
import { MaterialModule } from './material.module';
import { SharedModule } from './shared.module';
import { CommonModule } from '@angular/common';
import { UserRoutingModule } from '../user.routing.module';
import { UserComponent } from '../components/user/user.component';
import { UserActionsComponent } from '../components/user-actions/user.actions.component';
import { UserSettingsComponent } from '../components/user-settings/user-settings.component';
import { McpConnectionsComponent } from '../components/mcp-connections/mcp-connections.component';



@NgModule({
    imports: [
        CommonModule,
        SharedModule,
        MaterialModule,
        UserRoutingModule,
        McpConnectionsComponent,
    ],
    exports: [],
    declarations: [
        UserComponent,
        UserActionsComponent,
        UserSettingsComponent,

    ],
    providers: []
})



export class UserModule { }
