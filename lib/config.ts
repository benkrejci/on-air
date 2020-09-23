import os from 'os'

type GpioInputMode = 'ON_OFF' | 'TRIGGER'
type SensorModel = 'ADAFRUIT_BH1750'
type InputAction = 'STATUS' | 'BRIGHTNESS'
type InputPull = 'UP' | 'DOWN'
type OutputMode = 'ON_OFF' | 'PWM'
type TransformFunction = 'CONSTANT' | 'SIN' | 'LINEAR' | 'LOG' | 'EXP'

const SERVICE_PORT_DEFAULT = 8991
const SERVICE_NAME_DEFAULT = `on-air-box-${os.hostname()}`
const INPUT_DEBOUNCE_DELAY_DEFAULT = 50 // ms
const GPIO_INPUT_MODE_DEFAULT: GpioInputMode = 'ON_OFF'
const INPUT_ACTION_DEFAULT: InputAction = 'STATUS'
const INPUT_PULL_DEFAULT: InputPull = 'DOWN'
const OUTPUT_MODE_DEFAULT: OutputMode = 'ON_OFF'
const OUTPUT_FUNCTION_PERIOD_DEFAULT: number = 2000 // ms

export interface TransformFunctionRawConfig {
    function: TransformFunction
    value?: number
    period?: number
    offset?: number
    min?: number
    max?: number
    coefficient?: number
    base?: number
}

export interface RawConfig {
    statuses: string[]
    defaultStatus: string

    service?: {
        port?: number
        name?: string
    }

    box: {
        // in ms (so default 50ms)
        inputDebounceDelay?: number
        // float between 0 and 1
        defaultBrightness?: number

        lightSensor?: {
            model: SensorModel
            address?: number
            bus?: number
            transform?: TransformFunctionRawConfig
        }

        inputsByName?: {
            [name: string]:
                | number
                | {
                      type?: 'GPIO'
                      mode?: GpioInputMode
                      pull?: InputPull
                      pin: number
                      action?: InputAction
                      onValue?: any
                      offValue?: any
                  }
        }

        outputsByName?: {
            [name: string]:
                | number
                | {
                      mode?: OutputMode
                      pin: number
                      range?: number
                      inverted?: boolean
                  }
        }

        outputsByStatus?: {
            [status: string]: {
                [name: string]: number | TransformFunctionRawConfig
            }
        }
    }
}

export interface ServiceConfig {
    readonly port: number
    readonly name: string
}

export interface InputGpioConfig {
    readonly type: 'GPIO'
    readonly name: string
    readonly mode: GpioInputMode
    readonly pull: InputPull
    readonly pin: number
    readonly action: InputAction
    readonly onValue?: any
    readonly offValue?: any
}

export type InputConfig = InputGpioConfig

export interface OutputConfig {
    readonly name: string
    readonly mode: OutputMode
    readonly pin: number
    readonly range: number
    readonly inverted: boolean
}

export interface ConstantTransformConfig {
    readonly function: 'CONSTANT'
    readonly value?: number
}

export interface SinTransformConfig {
    readonly function: 'SIN'
    readonly period: number
    readonly offset: number
    readonly min: number
    readonly max: number
}

export interface LinearTransformConfig {
    readonly function: 'LINEAR'
    readonly coefficient: number
    readonly offset: number
    readonly min?: number
    readonly max?: number
}

export interface LogTransformConfig {
    readonly function: 'LOG'
    readonly coefficient: number
    readonly base: number
    readonly offset: number
    readonly min?: number
    readonly max?: number
}

export interface ExpTransformConfig {
    readonly function: 'EXP'
    readonly coefficient: number
    readonly offset: number
    readonly min?: number
    readonly max?: number
}

export type TransformConfig =
    | ConstantTransformConfig
    | SinTransformConfig
    | LinearTransformConfig
    | LogTransformConfig
    | ExpTransformConfig

export interface BoxConfig {
    readonly inputDebounceDelay: number
    readonly defaultBrightness: number
    readonly lightSensor?: {
        model: SensorModel
        address: number
        bus: number
        transform: TransformConfig
    }
    readonly inputsByName?: Map<string, InputConfig>
    readonly outputsByName?: Map<string, OutputConfig>
    readonly outputTransformsByStatus?: Map<
        string,
        Map<string, TransformConfig>
    >
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
    if (!config.box.outputsByName !== !config.box.outputsByStatus)
        throw new TypeError(
            `outputByName supplied without any outputValuesByStatus or vice versa`,
        )
    if (!config.box.inputsByName && !config.box.outputsByName)
        throw new TypeError(
            `Must provide either input config, or output config, or both (otherwise Box won't have anything to do!)`,
        )

    const statuses: Array<string> = config.statuses.slice()

    const service: ServiceConfig = {
        port:
            config.service?.port !== undefined
                ? config.service.port
                : SERVICE_PORT_DEFAULT,
        name:
            config.service?.name !== undefined
                ? config.service.name
                : SERVICE_NAME_DEFAULT,
    }

    const inputDebounceDelay =
        config.box.inputDebounceDelay !== undefined
            ? config.box.inputDebounceDelay
            : INPUT_DEBOUNCE_DELAY_DEFAULT
    const defaultBrightness =
        config.box.defaultBrightness !== undefined
            ? config.box.defaultBrightness
            : 1

    let lightSensor
    if (config.box.lightSensor) {
        let brightnessTransform: TransformConfig
        if (!config.box.lightSensor.transform) {
            brightnessTransform = {
                function: 'LOG',
                coefficient: 0.5,
                base: 10,
                offset: -0.5,
                min: 0.05,
                max: config.box.defaultBrightness,
            }
        } else {
            switch (config.box.lightSensor.transform?.function) {
                case 'LINEAR':
                    brightnessTransform = {
                        function: 'LINEAR',
                        coefficient:
                            config.box.lightSensor.transform.coefficient !==
                            undefined
                                ? config.box.lightSensor.transform.coefficient
                                : 1,
                        offset: config.box.lightSensor.transform.offset || 0,
                        min: config.box.lightSensor.transform.min,
                        max: config.box.lightSensor.transform.max,
                    }
                    break
                case 'LOG':
                    brightnessTransform = {
                        function: 'LOG',
                        coefficient:
                            config.box.lightSensor.transform.coefficient !==
                            undefined
                                ? config.box.lightSensor.transform.coefficient
                                : 1,
                        base:
                            config.box.lightSensor.transform.base !== undefined
                                ? config.box.lightSensor.transform.base
                                : 10,
                        offset: config.box.lightSensor.transform.offset || 0,
                        min: config.box.lightSensor.transform.min,
                        max: config.box.lightSensor.transform.max,
                    }
                    break
                default:
                    throw new TypeError(
                        `lightSensor transform function ${config.box.lightSensor.transform.function} not yet implemented`,
                    )
            }
        }
        lightSensor = {
            model: config.box.lightSensor.model,
            address:
                config.box.lightSensor.address !== undefined
                    ? config.box.lightSensor.address
                    : 0x23,
            bus:
                config.box.lightSensor.bus !== undefined
                    ? config.box.lightSensor.bus
                    : 1,
            transform: brightnessTransform,
        }
    }

    const inputsByName: Map<string, InputConfig> | undefined =
        config.box.inputsByName &&
        new Map(
            Object.entries(config.box.inputsByName).map(([name, input]): [
                string,
                InputConfig,
            ] => {
                if (typeof input === 'number') {
                    input = { type: 'GPIO', pin: input }
                }

                // if (input.type === 'GPIO') {
                const mode = input.mode || GPIO_INPUT_MODE_DEFAULT
                const pull = input.pull || INPUT_PULL_DEFAULT
                const action = input.action || INPUT_ACTION_DEFAULT

                if (!input.onValue && !input.offValue)
                    throw new TypeError(
                        `Missing onValue/offValue option for input ${name} with mode "${input.mode}"`,
                    )

                return [
                    name,
                    {
                        type: 'GPIO',
                        name,
                        mode,
                        pull,
                        pin: input.pin,
                        action: action,
                        onValue: input.onValue,
                        offValue: input.offValue,
                    },
                ]
            }),
        )

    const outputsByName: Map<string, OutputConfig> | undefined =
        config.box.outputsByName &&
        new Map(
            Object.entries(config.box.outputsByName).map(([name, output]) => {
                if (typeof output === 'number') {
                    output = { pin: output }
                }

                const mode = output.mode || OUTPUT_MODE_DEFAULT
                const range =
                    output.range !== undefined
                        ? output.range
                        : mode === 'ON_OFF'
                        ? 1
                        : DEFAULT_PWM_RANGE
                if (mode === 'ON_OFF' && range !== 1)
                    throw new TypeError(
                        `Invalid range ${output.range} for binary output ${name}. If specified, range must be 1`,
                    )

                return [
                    name,
                    {
                        name,
                        mode,
                        range,
                        pin: output.pin,
                        inverted: output.inverted === true,
                    },
                ]
            }),
        )

    const outputTransformsByStatus:
        | Map<string, Map<string, TransformConfig>>
        | undefined =
        config.box.outputsByStatus &&
        new Map(
            Object.entries(config.box.outputsByStatus).map(
                ([status, outputValues]) => {
                    if (!statuses.includes(status))
                        throw new TypeError(
                            `Invalid status ${status}; not present in statuses array`,
                        )
                    return [
                        status,
                        new Map(
                            Object.entries(outputValues).map(
                                ([name, value]) => {
                                    const output = outputsByName?.get(name)
                                    if (output === undefined)
                                        throw new TypeError(
                                            `Unknown output with name ${name}`,
                                        )

                                    if (typeof value === 'number') {
                                        value = {
                                            function: 'CONSTANT',
                                            value,
                                        }
                                    }

                                    let outputTransform: TransformConfig
                                    if (value.function === 'CONSTANT') {
                                        if (
                                            value.value === undefined ||
                                            value.value < 0 ||
                                            value.value > output.range
                                        ) {
                                            throw new TypeError(
                                                `Invalid output value of ${value}; must be number within output ${output.name} range 0 - ${output.range}`,
                                            )
                                        }
                                        outputTransform = {
                                            function: value.function,
                                            value: value.value,
                                        }
                                    } else if (value.function === 'SIN') {
                                        outputTransform = {
                                            function: value.function,
                                            period:
                                                value.period !== undefined
                                                    ? value.period
                                                    : OUTPUT_FUNCTION_PERIOD_DEFAULT,
                                            offset:
                                                value.offset !== undefined
                                                    ? value.offset
                                                    : 0,
                                            min:
                                                value.min !== undefined
                                                    ? value.min
                                                    : 0,
                                            max:
                                                value.max !== undefined
                                                    ? value.max
                                                    : output.range,
                                        }
                                    } else {
                                        throw new TypeError(
                                            `Output transform ${value.function} not implemented yet!`,
                                        )
                                    }
                                    return [name, outputTransform]
                                },
                            ),
                        ),
                    ]
                },
            ),
        )

    return {
        statuses,
        defaultStatus: config.defaultStatus,
        service,
        box: {
            inputDebounceDelay,
            defaultBrightness,
            lightSensor,
            inputsByName,
            outputsByName,
            outputTransformsByStatus: outputTransformsByStatus,
        },
    }
}
