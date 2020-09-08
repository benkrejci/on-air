import { debounce as _debounce } from 'debounce'

// I tried to use typescript-decorators-decorator but it is hopelessly broken

export function debounce<T>(interval?: number, immediate?: boolean): (target: T, propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor | void {
    return (target: T, propertyKey: string, descriptor: PropertyDescriptor) => {
        descriptor.value = _debounce(descriptor.value, interval, immediate)
    }
}
