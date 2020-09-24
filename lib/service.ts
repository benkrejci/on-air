import Bonjour from 'bonjour'
import { EventEmitter } from 'events'
import express from 'express'
import axios from 'axios'
import { Server } from 'http'
import { isIPv4 } from 'net'
import { Config } from './config'

const SERVICE_TYPE = 'on-air-box'
const API_PATH = 'api/v1'

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
    private readonly config: Config
    private readonly statusIndicesByStatus: Map<string, number>
    private readonly express = express().use(
        express.json(),
        express.urlencoded({ extended: true }),
    )
    private readonly httpServer: Server
    // all discovered services (including this one)
    private readonly allServices: Bonjour.Service[] = []
    // this service
    private readonly service: Bonjour.Service
    private readonly browser: Bonjour.Browser
    private readonly statusByFqdn: { [key: string]: string } = {}

    // what we should be showing locally (highest status of all services)
    private outputStatus: string

    public static create(config: Config): Service {
        return new Service(config)
    }

    public async setInputStatus(inputStatus: string): Promise<void> {
        if (!this.service)
            throw new Error(
                `Can't set status before bonjour service has been initialized`,
            )

        if (!this.config.statuses.includes(inputStatus))
            throw new Error(
                `setInputStatus called with status ${inputStatus} which is unrecognized by this service! This should never happen...`,
            )

        // update our status in status map and update our output
        this.setServiceStatus(this.service.fqdn, inputStatus)

        // notify all other services of the status change
        await Promise.all(
            this.allServices.map(async (service) => {
                await this.syncRemoteService(service)
            }),
        )
    }

    public async stop(): Promise<void> {
        await Promise.all([
            new Promise((resolve) => this.service.stop(() => resolve())),
            new Promise((resolve) => this.httpServer.close(() => resolve())),
        ])
    }

    private constructor(config: Config) {
        super()

        this.config = config
        this.outputStatus = config.defaultStatus
        this.statusIndicesByStatus = new Map(
            config.statuses.map((status, index) => [status, index]),
        )

        // initialize API server
        this.express.use(`/${API_PATH}/status`, (request, response) => {
            const responseBody: { success?: boolean; status: string } = {
                status: this.statusByFqdn[this.service.fqdn],
            }
            if (request.method === 'PUT') {
                const {
                    fqdn,
                    status,
                }: { fqdn: string; status: string } = request.body
                if (!this.config.statuses.includes(status)) {
                    this.error(
                        `remote service ${fqdn} tried to set status ${status} which is unrecognized by this service! Ensure all services on the network are using the same config`,
                    )
                    response.json({ success: false })
                } else {
                    const oldStatus = this.statusByFqdn[fqdn]
                    this.log(
                        `remote service ${fqdn} status changed from ${oldStatus} to ${status}`,
                    )
                    this.setServiceStatus(fqdn, status)
                    responseBody.success = true
                }
            }
            response.json(responseBody)
        })
        this.httpServer = this.express.listen(config.service.port, () => {
            this.log(
                `http api server started at localhost:${config.service.port}`,
            )
        })

        // look for other on-air services
        this.browser = bonjour.find(
            {
                type: SERVICE_TYPE,
            },
            (service: Bonjour.Service) => {
                // when new service comes online; this callback is equivalent to browser.on('up', func)
                // don't count this service
                if (service.name === config.service.name) return

                this.log(`discovered a friend box! 😍 [${service.fqdn}]`)
                // if this service already exists, remove it so it can be replaced
                for (const [
                    serviceIndex,
                    existingService,
                ] of this.allServices.entries()) {
                    if (existingService.fqdn === service.fqdn) {
                        this.allServices.splice(serviceIndex, 1)
                        break
                    }
                }
                // add it to our list of services
                this.allServices.push(service)
                // and give it our current input status
                this.syncRemoteService(service)
            },
        )
        // when service dies
        this.browser.on('down', (service: Bonjour.Service) => {
            const serviceIndex = this.allServices.indexOf(service)
            if (serviceIndex < 0) return
            // remove it from our list
            this.allServices.splice(serviceIndex, 1)
            // remove service status and recalculate output status
            delete this.statusByFqdn[service.fqdn]
            this.computeOutputStatus()
            this.log(`friend box went offline 😔 [${service.fqdn}]`)
        })

        // announce our service
        this.service = bonjour.publish({
            name: config.service.name,
            port: config.service.port,
            type: SERVICE_TYPE,
        })
        this.log(`on-air bonjour service announced at ${this.service.fqdn}`)

        // initialize our input status to off (this will go around and set our status on all discovered services)
        this.setInputStatus(this.config.defaultStatus)
    }

    private async syncRemoteService(service: Bonjour.Service): Promise<void> {
        const ip = service.addresses.find((a: string) => isIPv4(a))
        const url = `http://${ip}:${service.port}/${API_PATH}/status`
        const ourStatus = this.statusByFqdn[this.service.fqdn]
        try {
            const response = await axios.put(url, {
                fqdn: this.service.fqdn,
                status: ourStatus,
            })
            if (response.status !== 200 || !response.data?.success)
                throw new Error(
                    `bad response [${response.status}]: ${JSON.stringify(
                        response.data,
                    )}`,
                )
            this.setServiceStatus(service.fqdn, response.data.status)
        } catch (error) {
            // we'll consider this a recoverable error for now
            this.warn(`error updating status on ${url}: ${error.message}`)
            this.debug('status update error:', error)
        }
        this.log(
            `notified remote service ${service.fqdn} of our status: ${ourStatus}`,
        )
    }

    private setServiceStatus(fqdn: string, status: string): void {
        // set status in the status map
        this.statusByFqdn[fqdn] = status
        // update output status that we should be showing
        this.computeOutputStatus()
    }

    private computeOutputStatus(): void {
        const highestStatus = this.config.statuses[
            this.config.statuses.length - 1
        ]
        let newStatus: string = this.config.defaultStatus
        let newStatusIndex: number = <number>(
            this.statusIndicesByStatus.get(newStatus)
        )
        // loop through all input statuses being reported by services and find the highest one
        for (let status of Object.values(this.statusByFqdn)) {
            const statusIndex = <number>this.statusIndicesByStatus.get(status)
            if (statusIndex >= newStatusIndex) {
                newStatus = status
                newStatusIndex = statusIndex
            }
            if (status === highestStatus) break
        }

        if (this.outputStatus === newStatus) return

        this.log(
            `aggregate output status changed from ${this.outputStatus} to ${newStatus}`,
        )
        this.outputStatus = newStatus
        this.emit('outputStatus.update', this.outputStatus)
    }

    private log(message: string, ...args: any[]): void {
        console.log(`[service] ${message}`, ...args)
    }

    private warn(message: string, ...args: any[]): void {
        console.warn(`[service] ${message}`, ...args)
    }

    private error(message: string, ...args: any[]): void {
        console.error(`[service] ${message}`, ...args)
    }

    private debug(message: string, ...args: any[]): void {
        console.debug(`[service] ${message}`, args)
    }
}
