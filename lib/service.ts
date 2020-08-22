import * as os from 'os'
import Bonjour from 'bonjour'
import { EventEmitter } from 'events'
import express from 'express'
import axios from 'axios'
import { Status } from './types'
import bodyParser from 'body-parser'

const SERVICE_TYPE = 'http'
const DEFAULT_SERVICE_PORT = 8991
const SUB_TYPE = 'on-air-api-v1'
const API_PATH = 'api/v1'
const DEFAULT_SERVICE_NAME = `on-air-box-${os.hostname()}`

const bonjour = Bonjour({})

/**
 * Creates an http API server and announces a zeroconf/bonjour/avahi service on the local network
 *
 * Synchronizes status across all on-air services
 *
 * At any time, all outputs will reflect the highest state present on any input switch from any on-air service
 */
export class Service extends EventEmitter {
    // all discovered services (including this one)
    private readonly allServices: Bonjour.Service[] = []
    // this service
    private readonly service: Bonjour.Service
    private readonly browser: Bonjour.Browser
    private readonly statusByFqdn: { [key: string]: Status } = {}
    private readonly express = express().use(bodyParser.json(), bodyParser.urlencoded())

    // what we should be showing locally (highest status of all services)
    private outputStatus: Status = Status.Off

    public static create(name: string = DEFAULT_SERVICE_NAME, port: number = DEFAULT_SERVICE_PORT) {
        return new Service(name, port)
    }

    private constructor(name: string, port: number) {
        super()

        // start API server
        this.express.put(
            `${API_PATH}/status`,
            (request, response) => {
                const body: { fqdn: string, status: Status } = request.body
                this.setServiceStatus(body.fqdn, body.status)
                response.json({success: true})
            }
        )
        this.express.listen(port, () => {
            console.log(`on-air service http server started at ${this.service.fqdn}:${port}`)
        })

        // look for other on-air services
        this.browser = bonjour.find({
            type: SERVICE_TYPE,
        })
        // when new service comes on
        this.browser.on('up', (service) => {
            if (service.subtypes?.includes(SUB_TYPE)) {
                // add it to our list of services
                this.allServices.push(service)
                // and give it our current input status
                this.updateRemoteService(service)
            }
        })
        // when service dies
        this.browser.on('down', (service) => {
            // remove it from our list
            const serviceIndex = this.allServices.indexOf(service);
            if (serviceIndex > -1) this.allServices.splice(serviceIndex, 1);
            // remove service status and recalculate output status
            delete this.statusByFqdn[service.fqdn]
            this.computeOutputStatus()
        })

        // announce our service
        this.service = bonjour.publish({
            name,
            port,
            type: SERVICE_TYPE,
            subtypes: [SUB_TYPE],
        })

        // initialize our input status to off (this will go around and set our status on all discovered services)
        this.setInputStatus(Status.Off)
    }

    private setServiceStatus(fqdn: string, status: Status) {
        // set status in the status map
        this.statusByFqdn[fqdn] = status
        // update output status that we should be showing
        this.computeOutputStatus()
    }

    public async setInputStatus(inputStatus: Status) {
        if (!this.service) throw new Error('Can\'t set status before bonjour service has been initialized')

        // update our status in status map and update our output
        this.setServiceStatus(this.service.fqdn, inputStatus)

        // notify all other services of the status change
        await Promise.all(this.allServices.map(async (service) => {
            await this.updateRemoteService(service)
        }))
    }

    private async updateRemoteService(service: Bonjour.Service) {
        const url = `${service.host}:${service.port}/${API_PATH}/status`
        try {
            await axios.put(url, {
                fqdn: this.service.fqdn,
                status: this.statusByFqdn[this.service.fqdn],
            })
        } catch (error) {
            console.error(`Error updating status on ${url}:`, error)
        }
    }

    private computeOutputStatus() {
        let newStatus: Status = Status.Off
        for (let status of Object.values(this.statusByFqdn)) {
            if (status >= newStatus) newStatus = status
            if (status === Status.High) return
        }

        this.outputStatus = newStatus

        this.emit('outputStatus.update', this.outputStatus)
    }
}