import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { PoliciesComponent } from '../components/policies/policies.component';
import { PoliciesRoutingModule } from '../policies.routing.module';

@NgModule({
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    PoliciesRoutingModule,
  ],
  declarations: [PoliciesComponent],
})
export class PoliciesModule {}
