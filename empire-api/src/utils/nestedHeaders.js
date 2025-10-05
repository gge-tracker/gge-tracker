function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
            current[keys[i]] = {};
        }
        current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
}

function compareNestedHeaders(message, response) {
    if (message === null || response === null) {
        return false;
    } else if (Array.isArray(response)) {
        return response.some((item) => compareNestedHeaders(message, item));
    }
    for (const key in message) {
        if (typeof message !== typeof response) {
            return false;
        } else if (typeof message[key] === 'object') {
            if (!compareNestedHeaders(message[key], response[key])) {
                return false;
            }
        } else {
            if (!(key in response) || response[key] !== message[key]) {
                return false;
            }
        }
    }
    return true;
}

export { setNestedValue, compareNestedHeaders };