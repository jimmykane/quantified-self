const webpack = require('webpack');

module.exports = {
    resolve: {
        fallback: {
            "buffer": require.resolve("buffer/"),
            "stream": false,
            "crypto": false,
            "path": false,
            "fs": false
        },
        alias: {
            'node:buffer': require.resolve('buffer/')
        }
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
        }),
    ]
};
