"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Box = void 0;
const events_1 = require("events");
const onoff_1 = require("onoff");
const types_1 = require("./types");
const INPUT_DEBOUNCE_DELAY = 50;
/**
 * chose these pins to be next to each other from pins that are not reserved for alternate functions
 *
 * <---top-side--+
 *       -----   |
 *     3v3 | 5v  |
 *       2 | 5v  | r
 *       3 | G   | i
 *       4 | 14  | g
 *       G | 15  | h
 *    * 17 | 18  | t
 *    * 27 | G   |
 *      22 | 23 *| s
 *     3v3 | 24 *| i
 *      10 | G   | d
 *       9 | 25  | e
 *      11 | 8   |
 *       G | 7   |
 *       --+--   |  -- RPi 2+ only --
 *       0 | 1   | |
 *       5 | G   | v
 *       6 | 12  |
 *      13 | G   |
 *      19 | 16  |
 *      26 | 20  |
 *       G | 21  |
 *       -----   |
 *               v
 */
const OUT_PIN_BY_STATUS = {
    [types_1.Status.Low]: 17,
    [types_1.Status.High]: 27,
};
const IN_PIN_BY_STATUS = {
    [types_1.Status.Low]: 23,
    [types_1.Status.High]: 24
};
let box;
class Box extends events_1.EventEmitter {
    constructor() {
        super();
        this.inputStatus = types_1.Status.Off;
        this.outputStatus = types_1.Status.Off;
        this.inputByStatus = {};
        Object.entries(IN_PIN_BY_STATUS).forEach(([status, pin]) => {
            // 'rising' edge means event should trigger when connection is made, not when broken
            const input = this.inputByStatus[status] = new onoff_1.Gpio(pin, 'in', 'rising', { debounceTimeout: INPUT_DEBOUNCE_DELAY });
            input.watch((error) => {
                if (error) {
                    console.error(`Error on GPIO watcher on pin ${pin}`, error);
                }
                else {
                    this.setInputStatus(status);
                }
            });
        });
        this.outputByStatus = {};
        Object.entries(OUT_PIN_BY_STATUS).forEach(([status, pin]) => {
            this.outputByStatus[status] = new onoff_1.Gpio(pin, 'out');
        });
    }
    static create() {
        if (!box)
            box = new Box();
        return box;
    }
    getInputStatus() { return this.inputByStatus; }
    getOutputStatus() { return this.outputStatus; }
    setOutputStatus(newStatus) {
        if (this.outputStatus === newStatus)
            return;
        this.outputByStatus[this.outputStatus].writeSync(0);
        if (newStatus !== types_1.Status.Off) {
            this.outputByStatus[newStatus].writeSync(1);
        }
        this.outputStatus = newStatus;
    }
    setInputStatus(newStatus) {
        this.inputStatus = newStatus;
        this.emit('inputStatus.update', newStatus);
    }
}
exports.Box = Box;
//# sourceMappingURL=box.js.map