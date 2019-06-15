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
      style({ height: '*', opacity: '0', transform: 'translateX(-100%)', 'box-shadow': 'none' }),
      sequence([
        animate('.55s ease', style({ height: '*', opacity: '.2', transform: 'translateX(0)', 'box-shadow': 'none'  })),
        animate('.55s ease', style({ height: '*', opacity: 1, transform: 'translateX(0)' }))
      ])
    ]),
    transition(':leave', [
      style({ height: '*', opacity: '0', transform: 'translateX(-100%)', 'box-shadow': 'none' }),
      sequence([
        animate('.55s ease', style({ height: '*', opacity: '.2', transform: 'translateX(0)', 'box-shadow': 'none'  })),
        animate('.55s ease', style({ height: '*', opacity: 1, transform: 'translateX(0)' }))
      ])
    ])
  ]);

