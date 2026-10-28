import { registerLocaleData } from '@angular/common';
import localeEnGb from '@angular/common/locales/en-GB';
import 'dayjs/locale/en-gb';

registerLocaleData(localeEnGb);

export { AppServerModule as default } from './app/app.module.server';
