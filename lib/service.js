"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Service = void 0;
const os = __importStar(require("os"));
const Bonjour = __importStar(require("bonjour"));
const events_1 = require("events");
const axios_1 = __importDefault(require("axios"));
const types_1 = require("./types");
const SERVICE_TYPE = 'http';
const DEFAULT_SERVICE_PORT = 8991;
const OUTPUT_SUB_TYPE = 'on-air-output-api-v1';
const INPUT_SUB_TYPE = 'on-air-input-api-v1';
const DEFAULT_SERVICE_NAME = `on-air-box-${os.hostname()}`;
const bonjour = Bonjour({});
class Service extends events_1.EventEmitter {
    constructor(name, port) {
        super();
        this.outputServices = [];
        this.service = null;
        this.statusByFqdn = {};
        this.outputStatus = types_1.Status.Off;
        this.browser = bonjour.find({
            type: SERVICE_TYPE,
        });
        this.browser.on('up', (service) => {
            var _a;
            if ((_a = service.subtypes) === null || _a === void 0 ? void 0 : _a.includes(OUTPUT_SUB_TYPE)) {
                this.outputServices.push(service);
            }
        });
        this.browser.on('down', (service) => {
            const serviceIndex = this.outputServices.indexOf(service);
            if (serviceIndex > -1)
                this.outputServices.splice(serviceIndex, 1);
        });
        this.service = bonjour.publish({
            name,
            port,
            type: SERVICE_TYPE,
            subtypes: [INPUT_SUB_TYPE, OUTPUT_SUB_TYPE],
        });
        this.setStatus(types_1.Status.Off);
    }
    static create(name = DEFAULT_SERVICE_NAME, port = DEFAULT_SERVICE_PORT) {
        return new Service(name, port);
    }
    async setStatus(status) {
        if (!this.service)
            throw new Error('Can\'t set status before bonjour service has been initialized');
        this.statusByFqdn[this.service.fqdn] = status;
        this.computeOutputStatus();
        await Promise.all(this.outputServices.map(async (service) => {
            const url = `${service.host}:${service.port}`;
            try {
                await axios_1.default.post(url);
            }
            catch (error) {
                console.error(`Error updating status on ${url}:`, error);
            }
        }));
    }
    computeOutputStatus() {
        let newStatus = types_1.Status.Off;
        for (let status of Object.values(this.statusByFqdn)) {
            if (status >= newStatus)
                newStatus = status;
            if (status === types_1.Status.High)
                return;
        }
        this.outputStatus = newStatus;
        this.emit('outputStatus.update', this.outputStatus);
    }
}
exports.Service = Service;
//# sourceMappingURL=service.js.map