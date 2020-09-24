import { CLOCK_PWM, Gpio, configureClock } from 'pigpio'
import { Config, TransformConfig } from './config'

import Bh1750 from 'bh1750_lux'
import { EventEmitter } from 'events'
import assert from 'assert'
import { debounce } from './decorators'

const SAMPLE_RATE = 5 // us
const PWM_FREQUENCY = 800 // hz
const OUTPUT_FUNCTION_PERIOD = 1000 / 60 // 60 fps
assert(
    OUTPUT_FUNCTION_PERIOD > (2 * 1000) / PWM_FREQUENCY,
    'OUTPUT_FUNCTION_PERIOD should not be less than 2 PWM pulses',
)
const LIGHT_SENSOR_MIN_POLL_PERIOD = 200 // ms
const LIGHT_SENSOR_MOVING_AVERAGE_N = 10

configureClock(SAMPLE_RATE, CLOCK_PWM)

export class Box extends EventEmitter {
    private readonly config: Config
    private readonly outputByName: Map<string, Gpio> = new Map()
    private readonly inputByName: Map<string, Gpio> = new Map()

    private bh1750Sensor?: Bh1750
    private lightSensorLastReadingTime?: number
    private lastSensorBrightness?: number
    private lightSensorReadings: number[] = []

    private outputFunctionInterval: NodeJS.Timeout | null = null

    private inputStatus: string
    private outputStatus: string
    private brightnessOverride?: number

    public static create(config: Config): Box {
        return new Box(config)
    }

    public getInputStatus() {
        return this.inputStatus
    }
    public getOutputStatus() {
        return this.outputStatus
    }

    public setOutputStatus(newStatus: string): void {
        if (this.outputStatus === newStatus) return
        this.outputStatus = newStatus
        this.updateOutputStatus()
    }

    private updateOutputStatus(silent = false): void {
        if (!this.config.box.outputTransformsByStatus || !this.outputStatus)
            return

        const outputTransforms = this.config.box.outputTransformsByStatus.get(
            this.outputStatus,
        )
        if (outputTransforms === undefined) {
            console.warn(
                `setOutputStatus was called with status ${this.outputStatus} which has no outputs configured`,
            )
            return
        }

        // only update once if value will be constant (no light sensor polling or periodic output functions)
        let updateOnce = !this.config.box.lightSensor
        if (updateOnce) {
            for (const [status, transform] of outputTransforms) {
                if (transform.function !== 'CONSTANT') {
                    updateOnce = false
                    break
                }
            }
        }
        if (updateOnce) {
            // if outputs will not change, just update now
            this.outputFunctionTick()
            this.stopOutputFunctions()
        } else {
            // otherwise, start interval to periodically update outputs
            this.startOutputFunctions()
        }

        if (!silent) {
            this.log(`box output LED changed to ${
                this.outputStatus
            } at brightness ${this.brightnessOverride}
        +--${'-'.repeat(this.outputStatus.length)}--+
        |  ${this.outputStatus}  |
        +--${'-'.repeat(this.outputStatus.length)}--+`)
        }
    }

    private setOutput(name: string, value: number) {
        const outputConfig = this.config.box.outputsByName?.get(name)
        const output = this.outputByName.get(name)
        if (outputConfig === undefined || output === undefined) return // this case is already handled by parseConfig()

        if (outputConfig.inverted) value = outputConfig.range - value
        if (outputConfig.mode === 'ON_OFF') {
            output.digitalWrite(value)
        } else {
            this.getBrightness().then((brightness) => {
                value = Math.round(brightness * value)
                output.pwmWrite(value)
            })
        }
    }

    // this may be async in the future so just return a promise (see service.stop)
    public stop(): Promise<void> {
        this.setOutputStatus(this.config.defaultStatus)
        if (this.outputFunctionInterval !== null)
            clearInterval(this.outputFunctionInterval)
        return Promise.resolve()
    }

    private constructor(config: Config) {
        super()

        this.config = config
        this.inputStatus = this.outputStatus = this.config.defaultStatus

        this.log(
            `starting Box hardware controller with ${
                config.box.inputsByName?.size || 0
            } input and ${config.box.outputsByName?.size || 0} outputs`,
        )

        this.initOutput()
        this.initInput()
        this.initSensor()
    }

    private initInput(): void {
        this.config.box.inputsByName?.forEach((inputConfig, name) => {
            // if (inputConfig.type === 'GPIO') {
            const input = new Gpio(inputConfig.pin, {
                mode: Gpio.INPUT,
                pullUpDown:
                    inputConfig.pull === 'UP' ? Gpio.PUD_UP : Gpio.PUD_DOWN,
                alert: true,
            })
            input.glitchFilter(this.config.box.inputDebounceDelay * 1000) // config is in ms, glitchFilter takes ns

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
                output.pwmFrequency(PWM_FREQUENCY)
            }

            this.outputByName.set(name, output)
        })
    }

    private initSensor(): void {
        if (!this.config.box.lightSensor) return

        const lightSensor = this.config.box.lightSensor
        if (lightSensor.model === 'ADAFRUIT_BH1750') {
            this.bh1750Sensor = new Bh1750({
                addr: lightSensor.address,
                bus: lightSensor.bus,
                read: 'continuous',
            })
        }
    }

    public setBrightness(level: number, silent = false) {
        if (level < 0 || level > 1)
            throw new TypeError(
                `Invalid brightness ${level}, must be between 0 and 1`,
            )
        this.brightnessOverride = level
        this.updateOutputStatus(silent)
    }

    private getBrightness(): Promise<number> {
        if (this.brightnessOverride !== undefined)
            return Promise.resolve(this.brightnessOverride)

        const lightSensorConfig = this.config.box.lightSensor
        if (!this.bh1750Sensor || !lightSensorConfig)
            return Promise.resolve(this.config.box.defaultBrightness)

        const time = +new Date()
        if (
            this.lightSensorLastReadingTime &&
            this.lastSensorBrightness &&
            time - this.lightSensorLastReadingTime <
                LIGHT_SENSOR_MIN_POLL_PERIOD
        ) {
            return Promise.resolve(this.lastSensorBrightness)
        }

        this.lightSensorLastReadingTime = time

        return this.getLux()
            .then((lux: number) => {
                return this.transform(lightSensorConfig.transform, lux)
            })
            .then((brightness) => {
                this.lastSensorBrightness = brightness
                return brightness
            })
    }

    private getLux(): Promise<number> {
        if (!this.bh1750Sensor)
            return Promise.reject(
                new Error(`getLux called with no sensor initialized`),
            )

        return this.bh1750Sensor.readLight().then((lux: number) => {
            this.lightSensorReadings.push(lux)
            if (
                this.lightSensorReadings.length < LIGHT_SENSOR_MOVING_AVERAGE_N
            ) {
                return this.config.box.defaultBrightness
            } else if (
                this.lightSensorReadings.length > LIGHT_SENSOR_MOVING_AVERAGE_N
            ) {
                this.lightSensorReadings.shift()
            }
            return (
                this.lightSensorReadings.reduce((prev, cur) => prev + cur) /
                this.lightSensorReadings.length
            )
        })
    }

    @debounce()
    private setInputValue(name: string, value: number): void {
        this.log(`input ${name} set to ${value}`)

        const inputConfig = this.config.box.inputsByName?.get(name)
        if (inputConfig?.action === 'STATUS') {
            if (inputConfig.onValue !== undefined && value === 1) {
                this.setInputStatus(inputConfig.onValue)
            } else if (inputConfig.offValue !== undefined && value === 0) {
                this.setInputStatus(inputConfig.offValue)
            } else if (inputConfig?.mode === 'ON_OFF') {
                this.setInputStatus(this.config.defaultStatus)
            }
        } else if (inputConfig?.action === 'BRIGHTNESS') {
            if (inputConfig.onValue !== undefined && value === 1) {
                this.setBrightness(inputConfig.onValue)
            } else if (inputConfig.offValue !== undefined && value === 0) {
                this.setBrightness(inputConfig.offValue)
            } else if (inputConfig?.mode === 'ON_OFF') {
                this.setBrightness(this.config.box.defaultBrightness)
            }
        }
    }

    private setInputStatus(status: string): void {
        if (this.inputStatus === status) return
        this.log(`input switch changed from ${this.inputStatus} to ${status}`)
        this.inputStatus = status
        this.emit('inputStatus.update', status)
    }

    private stopOutputFunctions() {
        if (this.outputFunctionInterval !== null) {
            clearInterval(this.outputFunctionInterval)
            this.outputFunctionInterval = null
        }
    }

    private startOutputFunctions() {
        this.outputFunctionInterval = setInterval(
            this.outputFunctionTick.bind(this),
            OUTPUT_FUNCTION_PERIOD,
        )
    }

    private outputFunctionTick() {
        const outputFunctions = this.config.box.outputTransformsByStatus?.get(
            this.outputStatus,
        )
        if (!outputFunctions) return

        const t = +new Date()

        outputFunctions.forEach((functionConfig, name) => {
            const outputConfig = this.config.box.outputsByName?.get(name)
            const output = this.outputByName.get(name)
            if (outputConfig === undefined || output === undefined) return // this case is already handled by parseConfig()

            this.setOutput(name, this.transform(functionConfig, t))
        })
    }

    private transform(transform: TransformConfig, x: number): number {
        let ret: number
        switch (transform.function) {
            case 'CONSTANT':
                if (transform.value === undefined)
                    throw new TypeError(
                        `Unexpected undefined output function value`,
                    ) // this will never happen
                return transform.value

            case 'SIN':
                let y = Math.sin(
                    ((x - transform.xOffset) * 2 * Math.PI) / transform.period,
                )
                if (
                    transform.max !== undefined &&
                    transform.min !== undefined
                ) {
                    y =
                        (y / 2 + 0.5) * (transform.max - transform.min) +
                        transform.min
                }
                y += transform.yOffset
                return y

            case 'LINEAR':
                ret =
                    (x - transform.xOffset) * transform.coefficient +
                    transform.yOffset
                break

            case 'LOG':
                ret =
                    transform.coefficient * Math.log(x - transform.xOffset) +
                    transform.yOffset
                break

            default:
                throw new Error(
                    `Transform function ${transform.function} not implemented!`,
                )
        }

        if (transform.min !== undefined && ret < transform.min)
            ret = transform.min
        if (transform.max !== undefined && ret > transform.max)
            ret = transform.max

        return ret
    }

    private log(message: string, ...args: any[]): void {
        console.log(`[box] ${message}`, ...args)
    }

    private warn(message: string, ...args: any[]): void {
        console.warn(`[box] ${message}`, ...args)
    }
}
