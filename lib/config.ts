import _ from 'lodash'
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
const SHOW_LOCAL_STATUS_ON_GLOBAL_OUTPUT_DEFAULT = false
const OUTPUT_MODE_DEFAULT: OutputMode = 'ON_OFF'
const OUTPUT_FUNCTION_PERIOD_DEFAULT: number = 2000 // ms
const BRIGHTNESS_DEFAULT = 0.6 // 0 - 1

export interface TransformFunctionRawConfig {
    function: TransformFunction
    value?: number
    period?: number
    offset?: number
    min?: number
    max?: number
    coefficient?: number
}

export interface RawConfig {
    statuses: string[]
    defaultStatus: string
    showLocalStatusOnGlobalOutput: boolean

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

        globalStatusOutputsByName?: {
            [name: string]:
                | number
                | {
                      mode?: OutputMode
                      pin: number
                      range?: number
                      inverted?: boolean
                  }
        }

        localStatusOutputsByName?: {
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

export type ServiceConfig = Readonly<{
    port: number
    name: string
}>

export type InputGpioConfig = Readonly<{
    type: 'GPIO'
    name: string
    mode: GpioInputMode
    pull: InputPull
    pin: number
    action: InputAction
    onValue?: any
    offValue?: any
}>

export type InputConfig = InputGpioConfig

export type OutputConfig = Readonly<{
    name: string
    mode: OutputMode
    pin: number
    range: number
    inverted: boolean
}>

interface CommonTransformConfig {
    coefficient: number
    offset: number
    min?: number
    max?: number
}

export type ConstantTransformConfig = {
    function: 'CONSTANT'
    value?: number
}

export type SinTransformConfig = CommonTransformConfig & {
    function: 'SIN'
    period: number
}

export type LinearTransformConfig = CommonTransformConfig & {
    function: 'LINEAR'
}

export type LogTransformConfig = CommonTransformConfig & {
    function: 'LOG'
}

export type ExpTransformConfig = CommonTransformConfig & {
    function: 'EXP'
}

export type TransformConfig = Readonly<
    | ConstantTransformConfig
    | SinTransformConfig
    | LinearTransformConfig
    | LogTransformConfig
    | ExpTransformConfig
>

export type BoxConfig = Readonly<{
    inputDebounceDelay: number
    defaultBrightness: number
    lightSensor?: {
        model: SensorModel
        address: number
        bus: number
        transform: TransformConfig
    }
    inputsByName?: Map<string, InputConfig>
    globalStatusOutputsByName?: Map<string, OutputConfig>
    localStatusOutputsByName?: Map<string, OutputConfig>
    outputTransformsByStatus?: Map<string, Map<string, TransformConfig>>
}>

export type Config = Readonly<{
    statuses: Array<string>
    defaultStatus: string
    showLocalStatusOnGlobalOutput: boolean
    service: ServiceConfig
    box: BoxConfig
}>

const DEFAULT_PWM_RANGE = 255

export function parseConfig(rawConfig: RawConfig): Readonly<Config> {
    if (!rawConfig.statuses?.length)
        throw new TypeError(`Must provide at least one status in "statuses"`)
    if (!rawConfig.defaultStatus?.length)
        throw new TypeError(`Must provide defaultStatus`)
    if (
        !rawConfig.box.globalStatusOutputsByName !==
        !rawConfig.box.outputsByStatus
    )
        throw new TypeError(
            `outputByName supplied without any outputValuesByStatus or vice versa`
        )
    if (!rawConfig.box.inputsByName && !rawConfig.box.globalStatusOutputsByName)
        throw new TypeError(
            `Must provide either input config, or output config, or both (otherwise Box won't have anything to do!)`
        )

    let statuses = rawConfig.statuses.slice()
    let showLocalStatusOnGlobalOutput = _.defaultTo(
        rawConfig.showLocalStatusOnGlobalOutput,
        SHOW_LOCAL_STATUS_ON_GLOBAL_OUTPUT_DEFAULT
    )
    let service = {
        port: _.defaultTo(rawConfig.service?.port, SERVICE_PORT_DEFAULT),
        name: _.defaultTo(rawConfig.service?.name, SERVICE_NAME_DEFAULT),
    }

    const inputDebounceDelay = _.defaultTo(
        rawConfig.box.inputDebounceDelay,
        INPUT_DEBOUNCE_DELAY_DEFAULT
    )
    const defaultBrightness = _.defaultTo(
        rawConfig.box.defaultBrightness,
        BRIGHTNESS_DEFAULT
    )

    let lightSensor
    if (rawConfig.box.lightSensor) {
        let brightnessTransform: TransformConfig
        if (!rawConfig.box.lightSensor.transform) {
            // pretty good curve, looks like this: https://www.desmos.com/calculator/oqgxlgud8o
            // calculated here: https://keisan.casio.com/exec/system/14059930226691
            brightnessTransform = {
                function: 'LOG',
                coefficient: 0.13,
                offset: -0.0967,
                min: 0.05,
                max: rawConfig.box.defaultBrightness,
            }
        } else {
            switch (rawConfig.box.lightSensor.transform?.function) {
                case 'LINEAR':
                    brightnessTransform = {
                        function: 'LINEAR',
                        coefficient: _.defaultTo(
                            rawConfig.box.lightSensor.transform.coefficient,
                            1
                        ),
                        offset: _.defaultTo(
                            rawConfig.box.lightSensor.transform.offset,
                            0
                        ),
                        min: rawConfig.box.lightSensor.transform.min,
                        max: rawConfig.box.lightSensor.transform.max,
                    }
                    break
                case 'LOG':
                    brightnessTransform = {
                        function: 'LOG',
                        coefficient: _.defaultTo(
                            rawConfig.box.lightSensor.transform.coefficient,
                            1
                        ),
                        offset: _.defaultTo(
                            rawConfig.box.lightSensor.transform.offset,
                            0
                        ),
                        min: rawConfig.box.lightSensor.transform.min,
                        max: rawConfig.box.lightSensor.transform.max,
                    }
                    break
                default:
                    throw new TypeError(
                        `lightSensor transform function ${rawConfig.box.lightSensor.transform.function} not yet implemented`
                    )
            }
        }
        lightSensor = {
            model: rawConfig.box.lightSensor.model,
            address: _.defaultTo(rawConfig.box.lightSensor.address, 0x23),
            bus: _.defaultTo(rawConfig.box.lightSensor.bus, 1),
            transform: brightnessTransform,
        }
    }

    const inputsByName: Map<string, InputConfig> | undefined =
        rawConfig.box.inputsByName &&
        new Map(
            Object.entries(rawConfig.box.inputsByName).map(([name, input]): [
                string,
                InputConfig
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
                        `Missing onValue/offValue option for input ${name} with mode "${input.mode}"`
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
            })
        )

    const globalStatusOutputsByName:
        | Map<string, OutputConfig>
        | undefined = getOutputMap(rawConfig.box.globalStatusOutputsByName)
    const localStatusOutputsByName:
        | Map<string, OutputConfig>
        | undefined = getOutputMap(rawConfig.box.localStatusOutputsByName)

    const outputTransformsByStatus:
        | Map<string, Map<string, TransformConfig>>
        | undefined =
        rawConfig.box.outputsByStatus &&
        new Map(
            Object.entries(rawConfig.box.outputsByStatus).map(
                ([status, outputValues]) => {
                    if (!statuses.includes(status))
                        throw new TypeError(
                            `Invalid status ${status}; not present in statuses array`
                        )
                    return [
                        status,
                        new Map(
                            Object.entries(outputValues).map(
                                ([name, value]) => {
                                    const output = globalStatusOutputsByName?.get(
                                        name
                                    )
                                    if (output === undefined)
                                        throw new TypeError(
                                            `Unknown output with name ${name}`
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
                                                `Invalid output value of ${value}; must be number within output ${output.name} range 0 - ${output.range}`
                                            )
                                        }
                                        outputTransform = {
                                            function: 'CONSTANT',
                                            value: value.value,
                                        }
                                    } else if (value.function === 'SIN') {
                                        outputTransform = {
                                            function: 'SIN',
                                            period: _.defaultTo(
                                                value.period,
                                                OUTPUT_FUNCTION_PERIOD_DEFAULT
                                            ),
                                            coefficient: _.defaultTo(
                                                value.coefficient,
                                                1
                                            ),
                                            offset: _.defaultTo(
                                                value.offset,
                                                0
                                            ),
                                            min: _.defaultTo(value.min, 0),
                                            max: _.defaultTo(
                                                value.max,
                                                output.range
                                            ),
                                        }
                                    } else {
                                        throw new TypeError(
                                            `Output transform ${value.function} not implemented yet!`
                                        )
                                    }
                                    return [name, outputTransform]
                                }
                            )
                        ),
                    ]
                }
            )
        )

    return {
        statuses,
        defaultStatus: rawConfig.defaultStatus,
        showLocalStatusOnGlobalOutput,
        service,
        box: {
            inputDebounceDelay,
            defaultBrightness,
            lightSensor,
            inputsByName,
            globalStatusOutputsByName: globalStatusOutputsByName,
            localStatusOutputsByName: localStatusOutputsByName,
            outputTransformsByStatus: outputTransformsByStatus,
        },
    }
}

function getOutputMap(
    outputsByName: RawConfig['box']['globalStatusOutputsByName']
): Map<string, OutputConfig> | undefined {
    return (
        outputsByName &&
        new Map(
            Object.entries(outputsByName).map(([name, output]) => {
                if (typeof output === 'number') {
                    output = { pin: output }
                }

                const mode = output.mode || OUTPUT_MODE_DEFAULT
                const range = _.defaultTo(
                    output.range,
                    mode === 'ON_OFF' ? 1 : DEFAULT_PWM_RANGE
                )
                if (mode === 'ON_OFF' && range !== 1)
                    throw new TypeError(
                        `Invalid range ${output.range} for binary output ${name}. If specified, range must be 1`
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
            })
        )
    )
}
