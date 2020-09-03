import fs from 'fs'
import YAML from 'yaml'
import { Service } from './service'
import { Box } from './box'
import { Status } from "./types";
import path from 'path'

// create a box manager (monitors input switch and controls output LEDs)
let boxConfig
try {
    boxConfig = YAML.parse(fs.readFileSync(path.join(__dirname, '../config/box-config.yml'), 'utf8'))
} catch (e) {
    console.error(`Error reading box config file`, e)
    process.exit(1)
}
const box = Box.create(boxConfig)
// create a service (announces our service and synchronizes output state across all services discovered on the network)
const service = Service.create()
// when input switch is changed on box, update service
box.on('inputStatus.update', (status: Status) => {
    service.setInputStatus(status)
})
// when computed aggregate output status changes, update output LED on box
service.on('outputStatus.update', (status: Status) => {
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

process.on('uncaughtException', async () => {
    process.stdout.write('oops, uncaught exception 😬\n')
    await cleanUp(false)
})

process.on('unhandledRejection', async () => {
    process.stdout.write('oops, uncaught Promise rejection 😬\n')
    await cleanUp(false)
})

async function cleanUp(success: boolean) {
    process.stdout.write('trying to clean up...\n')
    process.stdout.write(' - "box" (hardware controller): stopping...')
    try {
        await box.stop()
        process.stdout.write(' dead\n')
    } catch (e) {
        process.stdout.write(' error! oh well\n')
    }
    process.stdout.write(' - service (http & mdns): stopping...')
    try {
        await service.stop()
        process.stdout.write(' dead\n')
    } catch (e) {
        process.stdout.write(' error! oh well\n')
    }
    process.stdout.write('goodbye\n')
    process.exit(success ? 0 : 1)
}
