import { EventEmitter } from 'events'
import { Gpio } from 'pigpio'
import { Config } from './config'
import { debounce } from './decorators'

export class Box extends EventEmitter {
    private readonly config: Config
    private readonly outputByName: Map<string, Gpio> = new Map()
    private readonly inputByName: Map<string, Gpio> = new Map()

    private inputStatus: string
    private outputStatus: string
    private brightness: number = 1

    public static create(config: Config): Box {
        return new Box(config)
    }

    public getInputStatus() { return this.inputStatus }
    public getOutputStatus() { return this.outputStatus }

    public setOutputStatus(newStatus: string): void {
        if (this.outputStatus === newStatus) return
        this.outputStatus = newStatus
        this.updateOutputStatus()
    }

    private updateOutputStatus(): void {
        if (!this.config.box.outputValuesByStatus || !this.outputStatus) return

        const outputValues = this.config.box.outputValuesByStatus.get(this.outputStatus)
        const outputValueStrings: string[] = []
        if (outputValues === undefined) {
            console.warn(`setOutputStatus was called with status ${this.outputStatus} which has no outputValues configured`)
            return
        }
        outputValues.forEach((value, name) => {
            const outputConfig = this.config.box.outputsByName?.get(name)
            const output = this.outputByName.get(name)
            if (outputConfig === undefined || output === undefined) return // this case is already handled by parseConfig()

            if (outputConfig.inverted) value = outputConfig.range - value
            if (outputConfig.mode === 'ON_OFF') {
                output.digitalWrite(value)
            } else {
                value = Math.round(this.brightness * value)
                output.pwmWrite(value)
            }
            outputValueStrings.push(`${name}: ${value}`)
        })

        this.log(`box output LED changed to ${this.outputStatus} at brightness ${this.brightness}
    +--${'-'.repeat(this.outputStatus.length)}--+
    |  ${this.outputStatus}  |
    +--${'-'.repeat(this.outputStatus.length)}--+${outputValueStrings.map(s => `
    - ${s}`).join()}`)
    }

    public setBrightness(level: number) {
        if (level < 0 || level > 1) throw new TypeError(`Invalid brightness ${level}, must be between 0 and 1`)
        this.brightness = level
    }

    // this may be async in the future so just return a promise (see service.stop)
    public stop(): Promise<void> {
        this.setOutputStatus(this.config.defaultStatus)
        return Promise.resolve()
    }

    private constructor(config: Config) {
        super()

        this.config = config
        this.inputStatus = this.outputStatus = this.config.defaultStatus
        this.setBrightness(config.box.defaultBrightness)

        this.log(`starting Box hardware controller with ${config.box.inputsByName?.size || 0} input and ${config.box.outputsByName?.size || 0} outputs`)

        this.initOutput()
        this.initInput()
    }

    private initInput(): void {
        this.config.box.inputsByName?.forEach((inputConfig, name) => {
            const input = new Gpio(inputConfig.pin, {
                mode: Gpio.INPUT,
                pullUpDown: inputConfig.pull === 'UP' ? Gpio.PUD_UP : Gpio.PUD_DOWN,
                alert: true,
            })
            input.glitchFilter(this.config.box.inputDebounceDelay)

            // set current input value
            this.setInputValue(name, input.digitalRead())

            // when input value on this pin changes, update input value
            input.on('alert', (value, tick) => {
                this.setInputValue(name, input.digitalRead())
            })

            this.inputByName.set(name, input)
        })
    }

    private initOutput(): void {
        this.config.box.outputsByName?.forEach((outputConfig, name) => {
            const output = new Gpio(outputConfig.pin, {
                mode: Gpio.OUTPUT,
            })

            if (outputConfig.mode === 'PWM') {
                output.pwmRange(outputConfig.range)
            }

            this.outputByName.set(name, output)
        })
    }

    @debounce()
    private setInputValue(name: string, value: number): void {
        this.log(`input ${name} set to ${value}`)

        const inputConfig = this.config.box.inputsByName?.get(name)
        if (inputConfig?.mode === 'ON_OFF') {
            if (value === 1) {
                if (inputConfig.onStatus) this.setInputStatus(inputConfig.onStatus)
            } else {
                this.setInputStatus(this.config.defaultStatus)
            }
        } else if (inputConfig?.mode === 'TRIGGER') {
            if (inputConfig.trigger?.type === 'STATUS') {
                this.setInputStatus(inputConfig.trigger.value)
            } else if (inputConfig.trigger?.type === 'BRIGHTNESS') {
                this.setBrightness(inputConfig.trigger.value)
            }
        }
    }

    private setInputStatus(status: string): void {
        if (this.inputStatus === status) return
        this.log(`input switch changed from ${this.inputStatus} to ${status}`)
        this.inputStatus = status
        this.emit('inputStatus.update', status)
    }

    private log(message: string, ...args: any[]): void {
        console.log(`[box] ${message}`, ...args)
    }

    private warn(message: string, ...args: any[]): void {
        console.warn(`[box] ${message}`, ...args)
    }
}