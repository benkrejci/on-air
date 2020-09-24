declare module 'bh1750_lux' {
    export default class Bh1750_lux {
        constructor(opts: { addr?: number; bus?: number; read?: string })

        readLight(): Promise<number>
    }
}
