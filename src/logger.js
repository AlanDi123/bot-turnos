const moment = require('moment-timezone');

function createLogger(timezone, maxEntries = 50) {
    const logs = [];

    function log(msg) {
        const time = moment().tz(timezone).format('HH:mm');
        logs.unshift({ time, msg });
        if (logs.length > maxEntries) logs.pop();
        console.log(`[${time}] ${msg}`);
    }

    function getLogs() {
        return logs.slice();
    }

    return { log, getLogs };
}

module.exports = { createLogger };
