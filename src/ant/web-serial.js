/*
 * web-serial.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * implements the ANT+ transport and message protocol used to communicate with trainers and sensors.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

//
// Web Serial
//
import { existance } from '../functions.js';
import { SerialPort } from './web-serial-polyfill.js';

const values = {
    dynastreamId:       4047, // 0x0FCF
    ANT_USB_2_Stick_Id: 1008,
    ANT_USB_m_Stick_Id: 1009,
    baudRate:           115200,
};

const filters = {
    dynastream: { filters: [{ usbVendorId: values.dynastreamId }] },
};

function SerialDriver(args = {}) {
    const defaults = {
        filter:   [{ usbVendorId: values.dynastreamId }],
        baudRate: 115200,
        onData:  defaultOnData,
        onClose: () => {},
    };

    async function defaultRequest() {
        // get known device or request a new one
        const port = await navigator.serial.requestPort(filters.dynastream);
        return port;
    }

    const onData  = existance(args.onData, defaults.onData);
    const onClose = existance(args.onClose, defaults.onClose);
    const request = existance(args.request, defaultRequest);

    let port;
    let reader;
    let writer;
    let _reading = false;
    let _isOpen  = false;
    let readTask;

    function isOpen() { return _isOpen; }
    function setIsOpen(value) { _isOpen = value; return _isOpen; }

    function isReading() { return _reading; }
    function setReading(value) { _reading = value; return _reading; }


    async function open(cb = () => {}) {
        if(isOpen()) return;

        const requestedPort = await request();
        await requestedPort.open({
            baudRate: defaults.baudRate,
            flowControl: 'hardware',
            bufferSize: 8192,
        });

        try {
            if(!requestedPort.readable || !requestedPort.writable) {
                throw new Error('The selected ANT+ adapter does not provide serial streams.');
            }

            port = requestedPort;
            writer = port.writable.getWriter();
            setIsOpen(true);
            setReading(true);
            await cb();
            readTask = read().catch(error => {
                console.error(':ant :serial :reader-error', error);
            });
        } catch(error) {
            setIsOpen(false);
            setReading(false);
            writer?.releaseLock();
            writer = undefined;
            await requestedPort.close();
            port = undefined;
            throw error;
        }
    }

    async function close() {
        if(!port) return;
        setIsOpen(false);
        setReading(false);
        await reader?.cancel().catch(() => {});
        await readTask;
    }

    async function read() {
        try {
            reader = port.readable
                .pipeThrough(new TransformStream(new MessageTransformer()))
                .getReader();

            while(isReading()) {
                const {value, done} = await reader.read();
                if(done) break;
                onData(value);
            }
        } catch(error) {
            if(isReading()) {
                console.error(':ant :serial :reader-error', error);
                throw error;
            }
        } finally {
            reader?.releaseLock();
            reader = undefined;
            writer?.releaseLock();
            writer = undefined;
            const closingPort = port;
            port = undefined;
            setReading(false);
            setIsOpen(false);
            await closingPort?.close().catch(error => {
                console.error(':ant :serial :close-error', error);
            });
            onClose();
        }
    }

    function defaultOnData(data) {
        console.log(data);
    }

    async function write(dataview) {
        if(!isOpen() || !writer) {
            throw new Error('ANT+ adapter is not open.');
        }
        const bytes = new Uint8Array(
            dataview.buffer,
            dataview.byteOffset,
            dataview.byteLength
        );
        return writer.write(bytes);
    }

    return {
        isOpen,
        isReading,
        request,
        open,
        close,
        read,
        write,
    };
}

function SerialPolyfillDriver(args = {}) {

    async function request() {
        // get known device or request a new one
        const device = await navigator.usb.requestDevice(filters.dynastream);
        const port = new SerialPort(device);
        return port;
    }

    return SerialDriver(Object.assign(args, {request}));
}





// refactor
class MessageTransformer {
    constructor() {
        this.buffer = [];
        this.sync = 0xA4;
    }
    transform(chunk, controller) {
        this.buffer.push(...chunk);

        while(this.buffer.length >= 2) {
            const syncIndex = this.buffer.indexOf(this.sync);
            if(syncIndex === -1) {
                this.buffer.length = 0;
                return;
            }

            if(syncIndex > 0) this.buffer.splice(0, syncIndex);

            const messageLength = this.buffer[1] + 4;
            if(this.buffer.length < messageLength) return;

            controller.enqueue(Uint8Array.from(this.buffer.splice(0, messageLength)));
        }
    }
}
// end refactor

export { SerialDriver, SerialPolyfillDriver, MessageTransformer };
