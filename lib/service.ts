import * as os from 'os'
import Bonjour from 'bonjour'
import { EventEmitter } from 'events'
import express from 'express'
import axios from 'axios'
import { Status } from './types'
import { Server } from 'http'
import { isIPv4 } from 'net'

const SERVICE_TYPE = 'on-air-box'
const DEFAULT_SERVICE_PORT = 8991
const API_PATH = 'api/v1'
const DEFAULT_SERVICE_NAME = `on-air-box-${os.hostname()}`

const bonjour = Bonjour()

process.on('exit', () => {
    bonjour.destroy()
})

/**
 * Creates an http API server and announces a zeroconf/bonjour/avahi service on the local network
 *
 * Synchronizes status across all on-air services
 *
 * At any time, all outputs will reflect the highest state present on any input switch from any on-air service
 */
export class Service extends EventEmitter {
    private readonly express = express().use(express.json(), express.urlencoded({ extended: true }))
    private readonly httpServer: Server
    // all discovered services (including this one)
    private readonly allServices: Bonjour.Service[] = []
    // this service
    private readonly service: Bonjour.Service
    private readonly browser: Bonjour.Browser
    private readonly statusByFqdn: { [key: string]: Status } = {}

    // what we should be showing locally (highest status of all services)
    private outputStatus: Status = Status.Off

    public static create(name: string = DEFAULT_SERVICE_NAME,
                         port: number = DEFAULT_SERVICE_PORT): Service {
        return new Service(name, port)
    }

    public async setInputStatus(inputStatus: Status): Promise<void> {
        if (!this.service) throw new Error('Can\'t set status before bonjour service has been initialized')

        // update our status in status map and update our output
        this.setServiceStatus(this.service.fqdn, inputStatus)

        // notify all other services of the status change
        await Promise.all(this.allServices.map(async (service) => {
            await this.updateRemoteService(service)
        }))
    }

    public async stop(): Promise<void> {
        await Promise.all([
            new Promise(resolve => this.service.stop(() => resolve())),
            new Promise(resolve => this.httpServer.close(() => resolve())),
        ])
    }

    private constructor(name: string, port: number) {
        super()

        // install API server
        this.express.put(
            `/${API_PATH}/status`,
            (request, response) => {
                const { fqdn, status }: { fqdn: string, status: Status } = request.body
                const oldStatus = this.statusByFqdn[fqdn]
                this.log(`remote service ${fqdn} status changed from ${oldStatus && Status[oldStatus]} to ${Status[status]}`)
                this.setServiceStatus(fqdn, status)
                response.json({ success: true })
            }
        )
        this.httpServer = this.express.listen(port, () => {
            this.log(`http api server started at localhost:${port}`)
        })

        // look for other on-air services
        this.browser = bonjour.find({
            type: SERVICE_TYPE,
        }, (service: Bonjour.Service) => {
            // when new service comes online; this callback is equivalent to browser.on('up', func)
            // don't count this service
            if (service.name === name) return
            // add it to our list of services
            this.allServices.push(service)
            // and give it our current input status
            this.updateRemoteService(service)
            this.log(`discovered a friend box! 😍 [${service.fqdn}]`)
        })
        // when service dies
        this.browser.on('down', (service: Bonjour.Service) => {
            const serviceIndex = this.allServices.indexOf(service);
            if (serviceIndex < 0) return
            // remove it from our list
            this.allServices.splice(serviceIndex, 1);
            // remove service status and recalculate output status
            delete this.statusByFqdn[service.fqdn]
            this.computeOutputStatus()
            this.log(`friend box went offline 😔 [${service.fqdn}]`)
        })

        // announce our service
        this.service = bonjour.publish({
            name,
            port,
            type: SERVICE_TYPE,
        })
        this.log(`on-air bonjour service announced at ${this.service.fqdn}`)

        // initialize our input status to off (this will go around and set our status on all discovered services)
        this.setInputStatus(Status.Off)
    }

    private async updateRemoteService(service: Bonjour.Service): Promise<void> {
        const ip = service.addresses.find((a: string) => isIPv4(a))
        const url = `http://${ip}:${service.port}/${API_PATH}/status`
        try {
            await axios.put(url, {
                fqdn: this.service.fqdn,
                status: this.statusByFqdn[this.service.fqdn],
            })
        } catch (error) {
            // we'll consider this a recoverable error for now
            this.warn(`error updating status on ${url}: ${error.message}`)
            this.debug('status update error:', error)
        }
    }

    private setServiceStatus(fqdn: string, status: Status): void {
        // set status in the status map
        this.statusByFqdn[fqdn] = status
        // update output status that we should be showing
        this.computeOutputStatus()
    }

    private computeOutputStatus(): void {
        let newStatus: Status = Status.Off
        for (let status of Object.values(this.statusByFqdn)) {
            if (status >= newStatus) newStatus = status
            if (status === Status.High) break
        }

        if (this.outputStatus === newStatus) return

        this.log(`aggregate output status changed from ${Status[this.outputStatus]} to ${Status[newStatus]}`)
        this.outputStatus = newStatus
        this.emit('outputStatus.update', this.outputStatus)
    }

    private log(message: string, ...args: any[]): void {
        console.log(`[service] ${message}`, ...args)
    }

    private warn(message: string, ...args: any[]): void {
        console.warn(`[service] ${message}`, ...args)
    }

    private debug(message: string, ...args: any[]): void {
        console.debug(`[service] ${message}`, args)
    }
}
