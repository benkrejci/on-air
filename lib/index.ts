import { Service } from './service'
import { Box } from './box'
import { Status } from "./types";

// create a box manager (monitors input switch and controls output LEDs)
const box = Box.create()
// create a service (announces our service and synchronizes output state across all services discovered on the network)
const service = Service.create()

service.setInputStatus(box.getInputStatus())
box.on('inputStatus.update', (status: Status) => {
    service.setInputStatus(status)
})

service.on('outputStatus.update', (status: Status) => {
    box.setOutputStatus(status)
})