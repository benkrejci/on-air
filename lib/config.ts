import os from 'os'

type Pull = 'up' | 'down'

interface RawConfig {
    statuses: string[]

    service?: {
        port?: number,
        name?: string,
    }

    box: {
        inputDebounceDelay: number

        inputsByName?: {
            [name: string]: number | {
                mode?: string
                pull?: Pull
                pin: number
            }
        }
        outputsByName?: {
            [name: string]: number | {
                mode?: string
                pin: number
                range?: number
                inverted?: boolean
            }
        }
        inputStatusRules?: Array<{
            status: string
            inputConditions: {
                [name: string]: number
            }
        }>
        outputValuesByStatus?: {
            [status: string]: {
                [name: string]: number
            }
        }
    }
}

const DEFAULT_SERVICE_PORT = 8991
const DEFAULT_SERVICE_NAME = `on-air-box-${os.hostname()}`

export interface ServiceConfig {
    readonly port: number
    readonly name: string
}

// may use other input types in the future 🤷‍
export enum InputMode {
    BINARY,
}

export interface InputConfig {
    readonly name: string
    readonly mode: InputMode
    readonly pull: Pull
    readonly pin: number
}

export enum OutputMode {
    BINARY,
    PWM,
}

export interface OutputConfig {
    readonly name: string
    readonly mode: OutputMode
    readonly pin: number
    readonly range: number
    readonly inverted: boolean
}

export interface StatusRule {
    readonly status: string
    readonly inputConditions: Map<string, number>
}

export interface BoxConfig {
    readonly inputsByName?: Map<string, InputConfig>
    readonly outputsByName?: Map<string, OutputConfig>
    readonly inputStatusRules?: Array<StatusRule>
    readonly outputValuesByStatus?: Map<string, Map<string, number>>
}

export const SPECIAL_OFF_STATUS = 'off'

export interface Config {
    readonly statuses: Array<string>
    readonly service: ServiceConfig
    readonly box: BoxConfig
}

const DEFAULT_PWM_RANGE = 255

export function parseConfig(config: RawConfig): Config {
    if (!config.statuses?.length)
        throw new TypeError(`Must provide at least one status in "statuses"`)
    if (!config.box.inputsByName !== !config.box.inputStatusRules)
        throw new TypeError(`inputByName supplied without any inputStatusRules or vice versa`)
    if (!config.box.outputsByName !== !config.box.outputValuesByStatus)
        throw new TypeError(`outputByName supplied without any outputValuesByStatus or vice versa`)
    if (!config.box.inputsByName && !config.box.outputsByName)
        throw new TypeError(`Must provide either input config, or output config, or both (otherwise Box won't have anything to do!)`)

    const statuses: Array<string> = config.statuses.slice()
    if (!config.statuses.includes(SPECIAL_OFF_STATUS))
        throw new TypeError(`Missing required "${SPECIAL_OFF_STATUS}" status (this status is used while initializing and when service is stopped`)

    const service: ServiceConfig = {
        port: config.service?.port !== undefined ? config.service.port : DEFAULT_SERVICE_PORT,
        name: config.service?.name !== undefined ? config.service.name : DEFAULT_SERVICE_NAME,
    }

    const inputsByName: Map<string, InputConfig> | undefined = config.box.inputsByName && new Map(
        Object.entries(config.box.inputsByName).map(([name, _input]) => {
            const input = typeof (_input) === 'number' ? {pin: _input} : _input

            return [name, {
                name,
                mode: input.mode ? InputMode[input.mode as keyof typeof InputMode] : InputMode.BINARY,
                pull: input.pull || 'down',
                pin: input.pin,
            }]
        })
    )

    const outputsByName: Map<string, OutputConfig> | undefined = config.box.outputsByName && new Map(
        Object.entries(config.box.outputsByName).map(([name, _output]) => {
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
                inverted: output.inverted === true
            }]
        })
    )

    const inputStatusRules: Array<StatusRule> | undefined = config.box.inputStatusRules?.map((statusRule) => {
        if (!statuses.includes(statusRule.status))
            throw new TypeError(`Invalid status ${statusRule.status}; not present in statuses array`)
        return {
            status: statusRule.status,
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
        service,
        box: {
            inputsByName,
            outputsByName,
            inputStatusRules,
            outputValuesByStatus,
        }
    }
}