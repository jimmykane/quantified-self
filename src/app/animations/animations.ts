import {trigger, sequence, state, animate, transition, style, query, group} from '@angular/animations';

export const rowsAnimation =
  trigger('rowsAnimation', [
    transition('void => *', [
      style({height: '*', opacity: '0', transform: 'translateY(-100%)', 'box-shadow': 'none'}),
      sequence([
        animate('.50s ease', style({height: '*', opacity: '.4', transform: 'translateY(0)', 'box-shadow': 'none'})),
        animate('.50s ease', style({height: '*', opacity: 1, transform: 'translateY(0)'}))
      ])
    ])
  ]);

export const slideInAnimation =
  trigger('routeAnimations', [
    transition('* <=> *', [
      query(':enter, :leave', style({position: 'fixed', width: '100%'}), {optional: true}),
      group([
        query(':enter', [
          style({opacity: 0, transform: 'translateX(100%)'}),
          animate('0.6s ease-in', style({ opacity: 1, transform: 'translateX(0%)'}))
        ], {optional: true}),
        query(':leave', [
          style({opacity: 1, transform: 'translateX(0%)'}),
          animate('0.6s ease-in', style({opacity: 0, transform: 'translateX(-100%)'}))
        ], {optional: true}),
      ])
    ]),
  ]);
