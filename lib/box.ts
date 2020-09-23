import { CLOCK_PWM, Gpio, configureClock } from 'pigpio'
import { Config, TransformConfig } from './config'

import { EventEmitter } from 'events'
import { debounce } from './decorators'

const SAMPLE_RATE = 5 // us
const PWM_FREQUENCY = 800 // hz
const LIGHT_SENSOR_UPDATE_PERIOD = 200 // ms
const LIGHT_SENSOR_MOVING_AVERAGE_N = 10

configureClock(SAMPLE_RATE, CLOCK_PWM)

export class Box extends EventEmitter {
    private readonly config: Config
    private readonly outputByName: Map<string, Gpio> = new Map()
    private readonly inputByName: Map<string, Gpio> = new Map()

    private lightSensortInterval: NodeJS.Timeout | null = null

    private outputFunctionStart: number = 0
    private outputFunctionInterval: NodeJS.Timeout | null = null

    private inputStatus: string
    private outputStatus: string
    private brightness: number = 1

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

    private updateOutputStatus(): void {
        if (!this.config.box.outputTransformsByStatus || !this.outputStatus)
            return

        const outputFunctions = this.config.box.outputTransformsByStatus.get(
            this.outputStatus,
        )
        if (outputFunctions === undefined) {
            console.warn(
                `setOutputStatus was called with status ${this.outputStatus} which has no outputs configured`,
            )
            return
        }
        let periodicFunctions = 0
        outputFunctions.forEach((outputFunction, name) => {
            if (outputFunction.function === 'CONSTANT') {
                if (outputFunction.value === undefined)
                    throw new TypeError(
                        `Unexpected undefined output function value`,
                    ) // this will never happen
                this.setOutput(name, outputFunction.value)
            } else {
                periodicFunctions++
            }
        })
        if (periodicFunctions > 0) {
            this.startOutputFunctions()
        } else {
            this.stopOutputFunctions()
        }

        this.log(`box output LED changed to ${
            this.outputStatus
        } at brightness ${this.brightness}
    +--${'-'.repeat(this.outputStatus.length)}--+
    |  ${this.outputStatus}  |
    +--${'-'.repeat(this.outputStatus.length)}--+`)
    }

    private setOutput(name: string, value: number) {
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
    }

    public setBrightness(level: number) {
        if (level < 0 || level > 1)
            throw new TypeError(
                `Invalid brightness ${level}, must be between 0 and 1`,
            )
        this.brightness = level
        this.updateOutputStatus()
    }

    // this may be async in the future so just return a promise (see service.stop)
    public stop(): Promise<void> {
        this.setOutputStatus(this.config.defaultStatus)
        if (this.lightSensortInterval !== null)
            clearInterval(this.lightSensortInterval)
        if (this.outputFunctionInterval !== null)
            clearInterval(this.outputFunctionInterval)
        return Promise.resolve()
    }

    private constructor(config: Config) {
        super()

        this.config = config
        this.inputStatus = this.outputStatus = this.config.defaultStatus
        this.setBrightness(config.box.defaultBrightness)

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
            const Bh1750 = require('bh1750_lux')
            const sensor = new Bh1750({
                addr: lightSensor.address,
                bus: lightSensor.bus,
                read: 'continuous',
            })

            const luxReadings: number[] = []

            this.lightSensortInterval = setInterval(() => {
                sensor.readLight().then((lux: number) => {
                    luxReadings.push(lux)
                    if (luxReadings.length < LIGHT_SENSOR_MOVING_AVERAGE_N)
                        return
                    else if (luxReadings.length > LIGHT_SENSOR_MOVING_AVERAGE_N)
                        luxReadings.shift()
                    const movingAverage =
                        luxReadings.reduce((prev, cur) => prev + cur) /
                        luxReadings.length
                    this.setBrightness(
                        Math.min(
                            1,
                            Math.max(
                                0,
                                this.transform(
                                    lightSensor.transform,
                                    movingAverage,
                                ),
                            ),
                        ),
                    )
                })
            }, LIGHT_SENSOR_UPDATE_PERIOD)
        }
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
        this.outputFunctionStart = +new Date()
        this.outputFunctionInterval = setInterval(
            this.outputFunctionTick.bind(this),
            1000 / PWM_FREQUENCY / 2, // should not try to update PWM more than half as often as the pulses
        )
    }

    private outputFunctionTick() {
        const outputFunctions = this.config.box.outputTransformsByStatus?.get(
            this.outputStatus,
        )
        if (!outputFunctions) return

        const t = +new Date() - this.outputFunctionStart

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
            case 'SIN':
                return (
                    ((transform.max - transform.min) *
                        (Math.sin(
                            ((x + transform.offset) / transform.period) *
                                2 *
                                Math.PI,
                        ) +
                            1)) /
                        2 +
                    transform.min
                )

            case 'LINEAR':
                ret = x * transform.coefficient + transform.offset
                break

            case 'LOG':
                ret =
                    (transform.coefficient * Math.log(x)) /
                        Math.log(transform.base) +
                    transform.offset
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
