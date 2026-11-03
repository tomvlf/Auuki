module.exports = {
    "testPathIgnorePatterns": ["/node_modules/", "<rootDir>/server/"],
    "setupFiles": [
        "<rootDir>/test/jest-setup.js"
    ],
    "transform": {
        "^.+\\.js$": "babel-jest"
    }
};
