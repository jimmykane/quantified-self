import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TrainingWorkspaceComponent } from './components/training/training-workspace.component';

const trainingRoutes: Routes = [{ path: '', component: TrainingWorkspaceComponent }];

@NgModule({
  imports: [RouterModule.forChild(trainingRoutes)],
  exports: [RouterModule],
})
export class TrainingRoutingModule {}
