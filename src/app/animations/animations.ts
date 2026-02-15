import { trigger, sequence, state, animate, transition, style, query, group } from '@angular/animations';

export const rowsAnimation =
  trigger('rowsAnimation', [
    transition('void => *', [
      style({ height: '*', opacity: '0', transform: 'translateY(-100%)', 'box-shadow': 'none' }),
      sequence([
        animate('.65s ease', style({ height: '*', opacity: '.4', transform: 'translateY(0)', 'box-shadow': 'none' })),
        animate('.65s ease', style({ height: '*', opacity: 1, transform: 'translateY(0)' }))
      ])
    ])
  ]);

export const expandCollapse =
  trigger('expandCollapse', [
    state('*', style({ width: '*', opacity: 1, overflow: 'hidden' })),
    transition(':enter', [
      style({ width: '0', opacity: 0, overflow: 'hidden' }),
      animate('0.3s ease-in-out', style({ width: '*', opacity: 1 }))
    ]),
    transition(':leave', [
      style({ width: '*', opacity: 1, overflow: 'hidden' }),
      animate('0.3s ease-in-out', style({ width: '0', opacity: 0 }))
    ])
  ]);

export const slideInAnimation =
  trigger('routeAnimations', [
    transition('* <=> *', [
      query(':enter, :leave', style({ position: 'absolute', inset: 0, width: '100%' }), { optional: true }),
      group([
        query(':enter', [
          style({ opacity: 0 }),
          animate('433ms ease-out', style({ opacity: 1 }))
        ], { optional: true }),
        query(':leave', [
          style({ opacity: 1 }),
          animate('180ms ease-in', style({ opacity: 0 }))
        ], { optional: true }),
      ])
    ]),
  ]);
