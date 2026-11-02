// Node-only paths shared by local launchers and compiled operational scripts.
const { homedir } = require('node:os');
const { isAbsolute, join, resolve } = require('node:path');
const { existsSync } = require('node:fs');

function localSecretPaths(environment = process.env) {
  const directory = environment.QS_LOCAL_CONFIG_DIR || join(homedir(), '.config', 'quantified-self');
  const absolute = value => {
    if (!isAbsolute(value)) throw new Error('Local secret paths must be absolute.');
    return resolve(value);
  };
  return {
    directory: absolute(directory),
    functions: absolute(environment.QS_LOCAL_SECRETS_FILE || join(directory, 'functions.env')),
    billing: absolute(environment.QS_BILLING_TEST_SECRETS_FILE || join(directory, 'billing-test.env')),
    signing: absolute(environment.QS_LOCAL_SIGNING_KEY_FILE || join(directory, 'firebase-adminsdk.json')),
    mail: absolute(join(directory, 'mail-service-account.json')),
    tlsKey: absolute(environment.QS_LOCAL_TLS_KEY_FILE || join(directory, 'tls', 'localhost.key')),
    tlsCert: absolute(environment.QS_LOCAL_TLS_CERT_FILE || join(directory, 'tls', 'localhost.crt')),
    runtime: absolute(join(directory, 'runtime')),
  };
}

exports.localSecretPaths = localSecretPaths;

function localMailCredentialPath(environment = process.env) {
  const configured = environment.GOOGLE_APPLICATION_CREDENTIALS;
  if (configured && !isAbsolute(configured)) throw new Error('Google credential paths must be absolute.');
  const local = localSecretPaths(environment);
  const candidates = configured ? [configured] : [local.mail, local.signing];
  const selected = candidates.find(file => existsSync(file));
  if (!selected) throw new Error('No external mail credential file is available. Set GOOGLE_APPLICATION_CREDENTIALS.');
  return selected;
}

exports.localMailCredentialPath = localMailCredentialPath;
