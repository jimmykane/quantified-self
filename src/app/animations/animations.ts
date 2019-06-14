import { trigger, sequence, state, animate, transition, style } from '@angular/animations';

export const rowsAnimation =
  trigger('rowsAnimation', [
    transition('void => *', [
      style({ height: '*', opacity: '0', transform: 'translateX(-100%)', 'box-shadow': 'none' }),
      sequence([
        animate('.55s ease', style({ height: '*', opacity: '.2', transform: 'translateX(0)', 'box-shadow': 'none'  })),
        animate('.55s ease', style({ height: '*', opacity: 1, transform: 'translateX(0)' }))
      ])
    ])
  ]);

export const removeAnimation =
  trigger('removeAnimation', [
    transition(':enter', [
      style({transform: 'translateX(100%)', opacity: 0}),
      animate('500ms', style({transform: 'translateX(0)', opacity: 1}))
    ]),
    transition(':leave', [
      style({transform: 'translateX(0)', opacity: 1}),
      animate('500ms', style({transform: 'translateX(100%)', opacity: 0}))
    ])
  ]);

