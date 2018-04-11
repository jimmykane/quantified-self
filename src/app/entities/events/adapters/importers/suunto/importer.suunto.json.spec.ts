import {EventImporterSuuntoJSON} from './importer.suunto.json';

const suuntoJSON = require('../../../../../../../samples/suunto/suunto.json');
const suuntoMultiSportJSON = require('../../../../../../../samples/suunto/multisport.json');


describe('EventImporterSuuntoJSON', () => {

  let event;

  beforeEach(() => {

  });


  it('should import correctly a multisport activity', () => {
    event = EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(suuntoMultiSportJSON));
  });


});
