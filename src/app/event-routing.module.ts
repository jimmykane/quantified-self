import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import {EventCardComponent} from './components/cards/event/event.card.component';


const routes: Routes = [
  {
    path: '',
    component: EventCardComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class EventRoutingModule { }
