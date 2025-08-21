// .solcover.js
module.exports = {
    skipFiles: [
        "mocks",
    ],
    istanbulReporter: ["text", "lcov"], // lcov for CI (Codecov/Coveralls), text for the console
};
