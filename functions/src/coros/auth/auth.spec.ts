
import { expect } from 'chai';
import { COROSAPIAuth } from './auth';

describe('COROS Auth Configuration', () => {
    it('should be configured to use body for authorization method', () => {
        // Access the configuration from the simple-oauth2 instance
        // Note: The specific property path depends on simple-oauth2 version, 
        // but usually it's exposed or we can check the constructor arguments if we mocked it.
        // Since we are importing the live instance, we'll try to inspect it.

        // cast to any to access private/internal config if necessary, or just check public props
        const authInstance = COROSAPIAuth as any;

        // Attempt to locate the options. 
        // Common paths: authInstance.config.options, authInstance.options
        const options = authInstance.config?.options || authInstance.options;

        // console.log('COROSAPIAuth config:', JSON.stringify(authInstance, null, 2));

        expect(options).to.exist;
        expect(options.authorizationMethod).to.equal('body');
    });
});
