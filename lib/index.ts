import fs from 'fs'
import YAML from 'yaml'
import { Service } from './service'
import { Box } from './box'
import path from 'path'
import { parseConfig } from './config'
import validateRawConfig from './config.validator'

// create a box manager (monitors input switch and controls output LEDs)
let config
try {
    config = parseConfig(
        validateRawConfig(
            YAML.parse(
                fs.readFileSync(
                    path.join(__dirname, '../config/config.yml'),
                    'utf8'
                )
            )
        )
    )
} catch (e) {
    console.error(`Error reading/parsing box config file`, e)
    process.exit(1)
}
const box = Box.create(config)
// create a service (announces our service and synchronizes output state across all services discovered on the network)
const service = Service.create(config)
// when input switch is changed on box, update service
box.on('inputStatus.update', (status: string) => {
    service.setInputStatus(status)
})
// when computed aggregate output status changes, update output LED on box
service.on('outputStatus.update', (status: string) => {
    box.setOutputStatus(status)
})
// set current input status
service.setInputStatus(box.getInputStatus())

process.on('SIGTERM', async () => {
    process.stdout.write('SIGTERM signal received\n')
    await cleanUp(true)
})

process.on('SIGINT', async () => {
    process.stdout.write('SIGTERM signal received\n')
    await cleanUp(true)
})

process.on('uncaughtException', async (error) => {
    process.stdout.write('oops, uncaught exception 😬\n')
    console.error(error)
    await cleanUp(false)
})

process.on('unhandledRejection', async (error) => {
    process.stdout.write('oops, uncaught Promise rejection 😬\n')
    console.error(error)
    await cleanUp(false)
})

let cleaningUp = false
async function cleanUp(success: boolean) {
    if (cleaningUp) return
    cleaningUp = true
    process.stdout.write('trying to clean up...\n')
    process.stdout.write(' - "box" (hardware controller): stopping...\n')
    try {
        await box.stop()
        process.stdout.write(' dead\n')
    } catch (e) {
        process.stdout.write(' error! oh well\n')
    }
    process.stdout.write(' - service (http & mdns): stopping...\n')
    try {
        await service.stop()
        process.stdout.write(' dead\n')
    } catch (e) {
        process.stdout.write(' error! oh well\n')
    }
    process.stdout.write('goodbye\n')
    process.exit(success ? 0 : 1)
}
