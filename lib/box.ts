import { EventEmitter } from 'events'
import { Gpio } from 'onoff'
import { Status } from './types';

const INPUT_DEBOUNCE_DELAY = 50

type StatusPinTuple = [Status, number]

/**
 * chose these pins to be next to each other from pins that are not reserved for alternate functions
 * this is where they are on the board:
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
const DEFAULT_OUT_STATUS_PINS: StatusPinTuple[] = [
    [Status.Low, 17],
    [Status.High, 27],
]
const DEFAULT_IN_STATUS_PINS: StatusPinTuple[] = [
    [Status.Low, 23],
    [Status.High, 24],
]

export class Box extends EventEmitter {
    private readonly outputByStatus: Map<Status, Gpio> = new Map()
    private readonly inputByStatus: Map<Status, Gpio> = new Map()

    private inputStatus: Status = Status.Off
    private outputStatus: Status = Status.Off

    public static create(outStatusPins: StatusPinTuple[] = DEFAULT_OUT_STATUS_PINS,
                         inStatusPins: StatusPinTuple[] = DEFAULT_IN_STATUS_PINS): Box {
        return new Box(outStatusPins, inStatusPins)
    }

    public getInputStatus() { return this.inputStatus }
    public getOutputStatus() { return this.outputStatus }

    public setOutputStatus(newStatus: Status): void {
        if (this.outputStatus === newStatus) return

        this.outputByStatus.get(this.outputStatus)?.writeSync(0)
        if (newStatus !== Status.Off) {
            this.outputByStatus.get(newStatus)?.writeSync(1)
        }

        this.outputStatus = newStatus
    }

    // this may be async in the future so just return a promise (see service.stop)
    public stop(): Promise<void> {
        this.inputByStatus.forEach(input => input.unexport())
        this.outputByStatus.forEach(output => output.unexport())
        return Promise.resolve()
    }

    private constructor(outStatusPins?: StatusPinTuple[], inStatusPins?: StatusPinTuple[]) {
        super()

        if (inStatusPins) {
            inStatusPins.forEach(([status, pin]) => {
                // 'rising' edge means event should trigger when connection is made, not when broken (from value 0 to 1)
                const input = new Gpio(
                    pin,
                    'in',
                    'rising',
                    {debounceTimeout: INPUT_DEBOUNCE_DELAY}
                )
                this.inputByStatus.set(status, input)

                // if input value is currently "on", set input status to this one
                if (input.readSync() === 1) this.setInputStatus(status)

                // when input value on this pin changes, update input status
                input.watch((error) => {
                    if (error) {
                        console.error(`Error on GPIO watcher on pin ${pin}`, error)
                    } else {
                        this.setInputStatus(status)
                    }
                })
            })
        }

        if (outStatusPins) {
            outStatusPins.forEach(([status, pin]) => {
                this.outputByStatus.set(status, new Gpio(pin, 'out'))
            })
        }
    }

    private setInputStatus(newStatus: Status): void {
        this.inputStatus = newStatus
        this.emit('inputStatus.update', newStatus)
    }
}