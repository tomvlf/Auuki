/*
 * dis.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * implements Bluetooth Low Energy device handling, services, and characteristic decoding for sensors and trainers.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { uuids } from '../uuids.js';
import { BLEService } from '../service.js';
import { existance, dataviewToString } from '../../functions.js';

function StringCharacteristic() {
    function encode() {}
    function decode(dataview) {
        return dataviewToString(dataview);
    }

    return Object.freeze({
        encode,
        decode,
    });
}

const stringCharacteristic = StringCharacteristic();

class DeviceInformationService extends BLEService {
    uuid = uuids.deviceInformation;

    postInit(args) {
        this.onInfo = existance(args.onInfo, ((x) => x));
        this.value  = this.defaultValue();

        this.characteristics = {
            manufacturerNameString: {
                uuid: uuids.f,
                supported: false,
                characteristic: undefined,
            },
            modelNumberString: {
                uuid: uuids.f,
                supported: false,
                characteristic: undefined,
            },
            serialNumberString: {
                uuid: uuids.f,
                supported: false,
                characteristic: undefined,
            },
            hardwareRevisionString: {
                uuid: uuids.f,
                supported: false,
                characteristic: undefined,
            },
            firmwareRevisionString: {
                uuid: uuids.f,
                supported: false,
                characteristic: undefined,
            },
            softwareRevisionString: {
                uuid: uuids.f,
                supported: false,
                characteristic: undefined,
            },
            systemID: {
                uuid: uuids.f,
                supported: false,
                characteristic: undefined,
            },
            regulatoryCertification: {
                uuid: uuids.f,
                supported: false,
                characteristic: undefined,
            },
            PnPID: {
                uuid: uuids.f,
                supported: false,
                characteristic: undefined,
            }
        };
    }
    defaultValue() {
        return {
            manufacturer: 'Unknown',
            model:        '',
            firmware:     '',
        };
    }
    async start() {
        const self = this;

        self.service = await self.ble.getService(self.server, self.uuid);

        await self.getCharacteristics(self.service);

        const info = self.readInfo();
        self.onInfo(info);
    }
    async readInfo() {
        const self = this;

        const info = self.defaultValue();

        if(self.supported('manufacturerNameString')) {
            info['manufacturer'] = await self.read('manufacturerNameString', stringCharacteristic.decode);
        }

        if(self.supported('modelNumberString')) {
            info['model'] = await self.read('modelNumberString', stringCharacteristic.decode);
        }

        if(self.supported('firmwareRevisionString')) {
            info['firmware'] = await self.read('firmwareRevisionString', stringCharacteristic.decode);
        }

        return info;
    }
};

export { DeviceInformationService };
