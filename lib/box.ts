import { EventEmitter } from 'events'
import { Gpio } from 'pigpio'
import { Status } from './types'
import { debounce } from 'typescript-debounce-decorator'

interface RawConfig {
    inputsByName?: {
        [name: string]: number | {
            mode?: string,
            pin: number,
        },
    },
    outputsByName?: {
        [name: string]: number | {
            mode?: string,
            pin: number,
            range?: number,
        },
    },
    inputStatusRules?: Array<{
        status: string,
        inputConditions: {
            [name: string]: number
        },
    }>,
    outputValuesByStatus?: {
        [status: string]: {
            [name: string]: number,
        }
    },
}

// may use other input types in the future 🤷‍
enum InputMode {
    BINARY,
}

interface InputConfig {
    readonly name: string
    readonly mode: InputMode
    readonly pin: number
}

enum OutputMode {
    BINARY,
    PWM,
}

interface OutputConfig {
    readonly name: string
    readonly mode: OutputMode
    readonly pin: number
    readonly range: number
}

interface StatusRule {
    readonly status: Status
    readonly inputConditions: Map<string, number>
}

interface Config {
    readonly inputsByName?: Map<string, InputConfig>
    readonly outputsByName?: Map<string, OutputConfig>
    readonly inputStatusRules?: Array<StatusRule>
    readonly outputValuesByStatus?: Map<Status, Map<string, number>>
}

const DEFAULT_PWM_RANGE = 255

function parseConfig(config: RawConfig): Config {
    if (!config.inputsByName !== !config.inputStatusRules)
        throw new TypeError(`inputByName supplied without any inputStatusRules or vice versa`)
    if (!config.outputsByName !== !config.outputValuesByStatus)
        throw new TypeError(`outputByName supplied without any outputValuesByStatus or vice versa`)
    if (!config.inputsByName && !config.outputsByName)
        throw new TypeError(`Must provide either input config, or output config, or both (otherwise Box won't have anything to do!)`)

    const inputsByName: Map<string, InputConfig> | undefined = config.inputsByName && new Map(
        Object.entries(config.inputsByName).map(([name, _input]) => {
            const input = typeof (_input) === 'number' ? {pin: _input} : _input

            return [name, {
                name,
                mode: input.mode ? InputMode[input.mode as keyof typeof InputMode] : InputMode.BINARY,
                pin: input.pin,
            }]
        })
    )

    const outputsByName: Map<string, OutputConfig> | undefined = config.outputsByName && new Map(
        Object.entries(config.outputsByName).map(([name, _output]) => {
            const output = typeof(_output) === 'number' ? { pin: _output } : _output

            const mode = output.mode ? OutputMode[output.mode as keyof typeof OutputMode] : OutputMode.BINARY
            const range = output.range !== undefined ? output.range :
                mode === OutputMode.BINARY ? 1 : DEFAULT_PWM_RANGE
            if (mode === OutputMode.BINARY && range !== 1)
                throw new TypeError(`Invalid range ${output.range} for binary output ${name}. If specified, range must be 1`)

            return [name, {
                name,
                mode,
                range,
                pin: output.pin,
            }]
        })
    )

    const inputStatusRules: Array<StatusRule> | undefined = config.inputStatusRules?.map((statusRule) => {
        const status = Status[statusRule.status as keyof typeof Status]
        return {
            status,
            inputConditions: new Map(
                Object.entries(statusRule.inputConditions).map(([name, value]) => {
                    const input = inputsByName?.get(name)
                    if (input === undefined)
                        throw new TypeError(`Unknown input with name ${name}`)

                    if (input.mode === InputMode.BINARY) {
                        if (!(value === 0 || value === 1))
                            throw new TypeError(`Bad value ${value} for binary input ${input.name} (must be 0 or 1)`)
                    }

                    return [name, value]
                })
            ),
        }
    })

    const outputValuesByStatus: Map<Status, Map<string, number>> | undefined = config.outputValuesByStatus && new Map(
        Object.entries(config.outputValuesByStatus).map(([status, outputValues]) => {
            return [Status[status as keyof typeof Status], new Map(
                Object.entries(outputValues).map(([name, value]) => {
                    const output = outputsByName?.get(name)
                    if (output === undefined)
                        throw new TypeError(`Unknown output with name ${name}`)

                    if (value < 0 || value > output.range)
                        throw new Error(`Invalid output value of ${value} is outside output ${output.name} range 0 - ${output.range}`)
                    return [name, value]
                })
            )]
        })
    )

    return {
        inputsByName,
        outputsByName,
        inputStatusRules,
        outputValuesByStatus,
    }
}

const INPUT_DEBOUNCE_DELAY = 50

export class Box extends EventEmitter {
    private readonly config: Config
    private readonly outputByName: Map<string, Gpio> = new Map()
    private readonly inputByName: Map<string, Gpio> = new Map()
    private readonly inputValueByName: Map<string, number> = new Map()

    private inputStatus: Status = Status.Off
    private outputStatus: Status = Status.Off

    public static create(rawConfig: RawConfig): Box {
        return new Box(parseConfig(rawConfig))
    }

    public getInputStatus() { return this.inputStatus }
    public getOutputStatus() { return this.outputStatus }

    public setOutputStatus(newStatus: Status): void {
        if (this.outputStatus === newStatus) return
        this.outputStatus = newStatus

        if (!this.config.outputValuesByStatus) return

        const outputValues = this.config.outputValuesByStatus.get(newStatus)
        const outputValueStrings: string[] = []
        if (outputValues === undefined) {
            console.warn(`setOutputStatus was called with status ${newStatus} which has no outputValues configured`)
            return
        }
        outputValues.forEach((value, name) => {
            const outputConfig = this.config.outputsByName?.get(name)
            const output = this.outputByName.get(name)
            if (outputConfig === undefined || output === undefined) return // this case is already handled by parseConfig()
            if (outputConfig.mode === OutputMode.BINARY) {
                output.digitalWrite(value)
            } else {
                output.pwmWrite(value)
            }
            outputValueStrings.push(`${name}: ${value}`)
        })

        const statusString = Status[newStatus]
        this.log(`box output LED changed from ${Status[this.outputStatus]} to ${statusString}
    +--${'-'.repeat(statusString.length)}--+
    |  ${statusString}  |
    +--${'-'.repeat(statusString.length)}--+${outputValueStrings.map(s => `
    - ${s}`).join()}`)
    }

    // this may be async in the future so just return a promise (see service.stop)
    public stop(): Promise<void> {
        return Promise.resolve()
    }

    private constructor(config: Config) {
        super()

        this.config = config

        this.log(`starting Box hardware controller with ${config.inputsByName?.size || 0} input and ${config.outputsByName?.size || 0} outputs`)

        if (config.inputsByName) {
            this.initInput()
        }

        if (config.outputsByName) {
            config.outputsByName.forEach((outputConfig, name) => {
                const output = new Gpio(outputConfig.pin, {
                    mode: Gpio.OUTPUT,
                })

                if (outputConfig.mode === OutputMode.PWM) {
                    output.pwmRange(outputConfig.range)
                }

                this.outputByName.set(name, output)
            })
        }
    }

    private initInput(): void {
        this.config.inputsByName?.forEach((inputConfig, name) => {
            // 'both' edge means event should trigger when connection is made and when broken
            const input = new Gpio(inputConfig.pin, {
                mode: Gpio.INPUT,
                pullUpDown: Gpio.PUD_UP,
                alert: true,
            })
            input.glitchFilter(INPUT_DEBOUNCE_DELAY)

            // set current input value
            this.setInputValue(name, input.digitalRead())

            // when input value on this pin changes, update input value
            input.on('alert', (value, tick) => {
                this.setInputValue(name, value)
            })

            this.inputByName.set(name, input)
        })
    }

    private setInputValue(name: string, value: number): void {
        this.inputValueByName.set(name, value)
        this.calculateInputStatus()
    }

    @debounce
    private calculateInputStatus(): void {
        if (!this.config.inputStatusRules) return
        for (let rule of this.config.inputStatusRules) {
            if (this.validateInputConditions(rule.inputConditions)) {
                this.setInputStatus(rule.status)
                break
            }
        }
    }

    private validateInputConditions(inputs: Map<string, number>): boolean {
        for (let [name, value] of inputs) {
            if (this.inputValueByName.get(name) !== value) {
                return false
            }
        }
        return true
    }

    private setInputStatus(status: Status): void {
        if (this.inputStatus === status) return
        this.log(`input switch changed from ${Status[this.inputStatus]} to ${Status[status]}`)
        this.inputStatus = status
        this.emit('inputStatus.update', status)
    }

    private log(message: string, ...args: any[]): void {
        console.log(`[box] ${message}`, ...args)
    }
}