import {IDClass} from './id.abstract.class';

describe('IDClass', () => {

  let idClass: IDClass;

  beforeEach(() => {
    idClass = new IdClass();
  });

  it('should correctly gen an ID', () => {
    expect(idClass.getID()).not.toBeFalsy();
  });

  it('should correctly set an ID', () => {
    idClass.setID('123');
    expect(idClass.getID()).toBe('123');
  });

});


export class IdClass extends IDClass {
}
