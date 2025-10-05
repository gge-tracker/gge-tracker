import EventEmitter from 'events';

class Event extends EventEmitter {
    constructor() {
        super();
        this.isSet = false;
    }

    set() {
        this.isSet = true;
        this.emit('set');
    }

    clear() {
        console.log("Event cleared");
        this.isSet = false;
    }

    async wait(timeout = -1) {
        if (this.isSet) return true;
        if (timeout === 0) return false;
        if (timeout === -1) return await new Promise((resolve) => this.once('set', resolve(true)));
        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                this.removeListener('set', onSet);
                resolve(false);
            }, timeout);
            const onSet = () => {
                clearTimeout(timeoutId);
                resolve(true);
            };
            this.on('set', onSet);
        });
    }
}

export { Event };