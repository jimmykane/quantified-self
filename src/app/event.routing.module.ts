import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { EventCardComponent } from './components/event/event.card.component';
import { eventResolver } from './resolvers/event.resolver';


export const eventRoutes: Routes = [
  {
    path: '',
    component: EventCardComponent,
    resolve: {
      event: eventResolver
    }
  }
];

@NgModule({
  imports: [RouterModule.forChild(eventRoutes)],
  exports: [RouterModule]
})
export class EventRoutingModule { }
