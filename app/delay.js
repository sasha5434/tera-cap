const colors = require('colors')

function getHrDiffTime(time) {
    // ts = [seconds, nanoseconds]
    const ts = process.hrtime(time);
    // конвертация секунд и наносекунд в милисекунды
    return (ts[0] * 1000) + (ts[1] / 1000000);
}

function outputDelay(interval, maxDelay) {
    maxDelay = maxDelay || 100;

    const before = process.hrtime();

    setTimeout(function () {
        const delay = getHrDiffTime(before) - interval;

        if (delay > maxDelay) {
            console.log('delay is %s', colors.red(delay));
        }

        outputDelay(interval, maxDelay);
    }, interval);
}

module['exports'] = outputDelay