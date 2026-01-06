// eslint.config.js
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["src/**/*.{ts,js}"],
        rules: {
            "no-unused-vars": "off", // Handled by TS
            "no-undef": "off",      // Handled by TS
            "@typescript-eslint/no-var-requires": "off",
            "@typescript-eslint/no-unused-vars": "warn",
            "@typescript-eslint/no-explicit-any": "warn"
        }
    },
    {
        ignores: ["node_modules/", "lib/", "coverage/", "eslint.config.js"]
    }
);
