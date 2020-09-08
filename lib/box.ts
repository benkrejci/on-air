import { EventEmitter } from 'events'
import { Gpio } from 'pigpio'
import { Config, OutputMode, SPECIAL_OFF_STATUS } from './config'
import { debounce } from './decorators'

const INPUT_DEBOUNCE_DELAY = 50 * 1000 // in nanoseconds (so 50ms)

export class Box extends EventEmitter {
    private readonly config: Config
    private readonly outputByName: Map<string, Gpio> = new Map()
    private readonly inputByName: Map<string, Gpio> = new Map()
    private readonly inputValueByName: Map<string, number> = new Map()

    private inputStatus: string = SPECIAL_OFF_STATUS
    private outputStatus: string = SPECIAL_OFF_STATUS

    public static create(config: Config): Box {
        return new Box(config)
    }

    public getInputStatus() { return this.inputStatus }
    public getOutputStatus() { return this.outputStatus }

    public setOutputStatus(newStatus: string): void {
        if (this.outputStatus === newStatus) return
        this.outputStatus = newStatus

        if (!this.config.box.outputValuesByStatus) return

        const outputValues = this.config.box.outputValuesByStatus.get(newStatus)
        const outputValueStrings: string[] = []
        if (outputValues === undefined) {
            console.warn(`setOutputStatus was called with status ${newStatus} which has no outputValues configured`)
            return
        }
        outputValues.forEach((value, name) => {
            const outputConfig = this.config.box.outputsByName?.get(name)
            const output = this.outputByName.get(name)
            if (outputConfig === undefined || output === undefined) return // this case is already handled by parseConfig()

            if (outputConfig.inverted) value = outputConfig.range - value
            if (outputConfig.mode === OutputMode.BINARY) {
                output.digitalWrite(value)
            } else {
                output.pwmWrite(value)
            }
            outputValueStrings.push(`${name}: ${value}`)
        })

        this.log(`box output LED changed from ${this.outputStatus} to ${newStatus}
    +--${'-'.repeat(newStatus.length)}--+
    |  ${newStatus}  |
    +--${'-'.repeat(newStatus.length)}--+${outputValueStrings.map(s => `
    - ${s}`).join()}`)
    }

    // this may be async in the future so just return a promise (see service.stop)
    public stop(): Promise<void> {
        this.setOutputStatus(SPECIAL_OFF_STATUS)
        return Promise.resolve()
    }

    private constructor(config: Config) {
        super()

        this.config = config

        this.log(`starting Box hardware controller with ${config.box.inputsByName?.size || 0} input and ${config.box.outputsByName?.size || 0} outputs`)

        this.initOutput()
        this.initInput()
    }

    private initInput(): void {
        this.config.box.inputsByName?.forEach((inputConfig, name) => {
            const input = new Gpio(inputConfig.pin, {
                mode: Gpio.INPUT,
                pullUpDown: inputConfig.pull === 'up' ? Gpio.PUD_UP : Gpio.PUD_DOWN,
                alert: true,
            })
            input.glitchFilter(INPUT_DEBOUNCE_DELAY)

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

            if (outputConfig.mode === OutputMode.PWM) {
                output.pwmRange(outputConfig.range)
            }

            this.outputByName.set(name, output)
        })
    }

    private setInputValue(name: string, value: number): void {
        this.log(`input ${name} set to ${value}`)
        this.inputValueByName.set(name, value)
        this.calculateInputStatus()
    }

    @debounce()
    private calculateInputStatus(): void {
        if (!this.config.box.inputStatusRules) return
        for (let rule of this.config.box.inputStatusRules) {
            if (this.validateInputConditions(rule.inputConditions)) {
                this.setInputStatus(rule.status)
                return
            }
        }
        this.warn(`no status rule matched input state 😫 setting to ${SPECIAL_OFF_STATUS}`)
        this.setInputStatus(SPECIAL_OFF_STATUS)
    }

    private validateInputConditions(inputs: Map<string, number>): boolean {
        for (let [name, value] of inputs) {
            if (this.inputValueByName.get(name) !== value) {
                return false
            }
        }
        return true
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