const moment = require('moment-timezone');

function createLogger(timezone) {
    const logs = [];

    function log(msg) {
        const time = moment().tz(timezone).format('HH:mm');
        logs.unshift({ time, msg });
        if (logs.length > 50) logs.pop();
        console.log(`[${time}] ${msg}`);
    }

    function getLogs() {
        return logs.slice();
    }

    return { log, getLogs };
}

module.exports = { createLogger };
