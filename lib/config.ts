import os from 'os'

type InputMode = 'ON_OFF' | 'TRIGGER'
type InputPull = 'UP' | 'DOWN'
type OutputMode = 'ON_OFF' | 'PWM'
type TriggerType = 'STATUS' | 'BRIGHTNESS'

const SERVICE_PORT_DEFAULT = 8991
const SERVICE_NAME_DEFAULT = `on-air-box-${os.hostname()}`
const INPUT_DEBOUNCE_DELAY_DEFAULT = 50 * 1000
const INPUT_MODE_DEFAULT: InputMode = 'ON_OFF'
const INPUT_PULL_DEFAULT: InputPull = 'DOWN'
const OUTPUT_MODE_DEFAULT: OutputMode = 'ON_OFF'

export interface RawConfig {
    statuses: string[]
    defaultStatus: string

    service?: {
        port?: number,
        name?: string,
    }

    box: {
        // in nanoseconds (so default 50ms)
        inputDebounceDelay?: number
        // float between 0 and 1
        defaultBrightness?: number

        inputsByName?: {
            [name: string]: number | {
                mode?: InputMode
                pull?: InputPull
                pin: number
                onStatus?: string
                trigger?: {
                    type: TriggerType
                    value: any
                }
            }
        }

        outputsByName?: {
            [name: string]: number | {
                mode?: OutputMode
                pin: number
                range?: number
                inverted?: boolean
            }
        }

        outputValuesByStatus?: {
            [status: string]: {
                [name: string]: number
            }
        }
    }
}

export interface ServiceConfig {
    readonly port: number
    readonly name: string
}

export interface InputConfig {
    readonly name: string
    readonly mode: InputMode
    readonly pull: InputPull
    readonly pin: number
    readonly onStatus?: string
    readonly trigger?: {
        readonly type: TriggerType
        readonly value: any
    }
}

export interface OutputConfig {
    readonly name: string
    readonly mode: OutputMode
    readonly pin: number
    readonly range: number
    readonly inverted: boolean
}

export interface BoxConfig {
    readonly inputDebounceDelay: number
    readonly defaultBrightness: number
    readonly inputsByName?: Map<string, InputConfig>
    readonly outputsByName?: Map<string, OutputConfig>
    readonly outputValuesByStatus?: Map<string, Map<string, number>>
}

export interface Config {
    readonly statuses: Array<string>
    readonly defaultStatus: string
    readonly service: ServiceConfig
    readonly box: BoxConfig
}

const DEFAULT_PWM_RANGE = 255

export function parseConfig(config: RawConfig): Config {
    if (!config.statuses?.length)
        throw new TypeError(`Must provide at least one status in "statuses"`)
    if (!config.defaultStatus?.length)
        throw new TypeError(`Must provide defaultStatus`)
    if (!config.box.outputsByName !== !config.box.outputValuesByStatus)
        throw new TypeError(`outputByName supplied without any outputValuesByStatus or vice versa`)
    if (!config.box.inputsByName && !config.box.outputsByName)
        throw new TypeError(`Must provide either input config, or output config, or both (otherwise Box won't have anything to do!)`)

    const statuses: Array<string> = config.statuses.slice()

    const service: ServiceConfig = {
        port: config.service?.port !== undefined ? config.service.port : SERVICE_PORT_DEFAULT,
        name: config.service?.name !== undefined ? config.service.name : SERVICE_NAME_DEFAULT,
    }

    const inputDebounceDelay = config.box.inputDebounceDelay !== undefined ? config.box.inputDebounceDelay : INPUT_DEBOUNCE_DELAY_DEFAULT
    const defaultBrightness = config.box.defaultBrightness !== undefined ? config.box.defaultBrightness : 1

    const inputsByName: Map<string, InputConfig> | undefined = config.box.inputsByName && new Map(
        Object.entries(config.box.inputsByName).map(([name, input]) => {
            if (typeof(input) === 'number') {
                input = { pin: input }
            }
            const mode = input.mode || INPUT_MODE_DEFAULT
            const pull = input.pull || INPUT_PULL_DEFAULT

            let trigger, onStatus
            if (input.mode === 'ON_OFF') {
                if (!input.onStatus) throw new TypeError(`Missing onStatus option for input ${name} with mode "${input.mode}"`)
                onStatus = input.onStatus
            } else if (input.mode === 'TRIGGER') {
                if (!input.trigger) throw new TypeError(`Missing trigger options for input "${name}" with mode "${input.mode}"`)
                trigger = {
                    type: input.trigger.type,
                    value: input.trigger.value,
                }
            }

            return [name, {
                name,
                mode,
                pull,
                pin: input.pin,
                trigger,
                onStatus
            }]
        })
    )

    const outputsByName: Map<string, OutputConfig> | undefined = config.box.outputsByName && new Map(
        Object.entries(config.box.outputsByName).map(([name, output]) => {
            if (typeof(output) === 'number') {
                output = { pin: output }
            }

            const mode = output.mode || OUTPUT_MODE_DEFAULT
            const range = output.range !== undefined ? output.range :
                mode === 'ON_OFF' ? 1 : DEFAULT_PWM_RANGE
            if (mode === 'ON_OFF' && range !== 1)
                throw new TypeError(`Invalid range ${output.range} for binary output ${name}. If specified, range must be 1`)

            return [name, {
                name,
                mode,
                range,
                pin: output.pin,
                inverted: output.inverted === true
            }]
        })
    )

    const outputValuesByStatus: Map<string, Map<string, number>> | undefined = config.box.outputValuesByStatus && new Map(
        Object.entries(config.box.outputValuesByStatus).map(([status, outputValues]) => {
            if (!statuses.includes(status))
                throw new TypeError(`Invalid status ${status}; not present in statuses array`)
            return [status, new Map(
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
        statuses,
        defaultStatus: config.defaultStatus,
        service,
        box: {
            inputDebounceDelay,
            defaultBrightness,
            inputsByName,
            outputsByName,
            outputValuesByStatus,
        }
    }
}