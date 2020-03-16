import {trigger, sequence, state, animate, transition, style, query, group} from '@angular/animations';

export const rowsAnimation =
  trigger('rowsAnimation', [
    transition('void => *', [
      style({height: '*', opacity: '0', transform: 'translateX(-100%)', 'box-shadow': 'none'}),
      sequence([
        animate('.55s ease', style({height: '*', opacity: '.2', transform: 'translateX(0)', 'box-shadow': 'none'})),
        animate('.55s ease', style({height: '*', opacity: 1, transform: 'translateX(0)'}))
      ])
    ])
  ]);

export const slideInAnimation =
  trigger('routeAnimations', [
    transition('* <=> *', [
      query(':enter, :leave', style({position: 'fixed', width: '100%'}), {optional: true}),
      group([
        query(':enter', [
          style({transform: 'translateX(100%)'}),
          animate('1.1s ease-in', style({transform: 'translateX(0%)'}))
        ], {optional: true}),
        query(':leave', [
          style({transform: 'translateX(0%)'}),
          animate('1.1s ease-in', style({transform: 'translateX(-100%)'}))
        ], {optional: true}),
      ])
    ]),
  ]);
