import {IDClass} from './id.abstract.class';

describe('IDClass', function () {

  let idClass: IDClass;

  beforeEach(() => {
    idClass = new IdClass();
  });

  it('should correctly gen an ID', function () {
    expect(idClass.getID()).not.toBeFalsy();
  });

  it('should correctly set an ID', function () {
    idClass.setID('123');
    expect(idClass.getID()).toBe('123');
  });

});


export class IdClass extends IDClass {
}
