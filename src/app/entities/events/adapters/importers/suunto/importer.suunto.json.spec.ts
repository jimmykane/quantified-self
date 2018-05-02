import {EventImporterSuuntoJSON} from './importer.suunto.json';
import {Event} from '../../../event';

const suuntoJSON = require('../../../../../../../samples/suunto/suunto.json');
const suuntoMultiSportJSON = require('../../../../../../../samples/suunto/multisport.json');


describe('EventImporterSuuntoJSON', () => {

  beforeEach(() => {

  });


  it('should import correctly a multisport activity', () => {
    expect(EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(suuntoMultiSportJSON)) instanceof Event).toBe(true);
  });


});
