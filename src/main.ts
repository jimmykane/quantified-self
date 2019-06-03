import {enableProdMode} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';

import {AppModule} from './app/app.module';
import {environment} from './environments/environment';
import {Log} from 'ng2-logger/browser';
import {AppThemes} from "quantified-self-lib/lib/users/user.app.settings.interface";

declare function require(moduleName: string): any;
const { version: appVersion } = require('../package.json');

if (environment.production) {
  // add Google Analytics script to <head>
  const analyticsScript = document.createElement('script');
  analyticsScript.innerHTML = `(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
    (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
    m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
    })(window,document,'script','https://www.google-analytics.com/analytics.js','ga');
    ga('create', 'UA-61188889-2', 'auto');
    ga('set', 'anonymizeIp', true);
    ga('send', 'pageview');`;
  document.head.appendChild(analyticsScript);

  enableProdMode();
  Log.setProductionMode();
}

// Set the theme before app is running
if (localStorage.getItem('appTheme')) {
  localStorage.getItem('appTheme') === AppThemes.Normal ? document.body.classList.remove('dark-theme') : document.body.classList.add('dark-theme')
}


platformBrowserDynamic().bootstrapModule(AppModule);
