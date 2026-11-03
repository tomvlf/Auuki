import { dataviewToArray } from '../../src/functions.js';
import { fit } from '../../src/fit/fit.js';
import { appData, FITjs, flatFitBinary } from './data.js';

describe('Local activity export', () => {
    test('includes the current product schema, samples, lap and session statistics', () => {
        const records = fit.localActivity.toFITjs({...appData, ftp: 250});
        expect(records[0]).toEqual({
            type: 'header', length: 14, headerSize: 14, protocolVersion: '2.0',
            profileVersion: '21.40', dataSize: 460, dataType: '.FIT', crc: 0,
        });
        expect(records.filter(record => record.type === 'definition').map(record => record.name))
            .toEqual(['file_id', 'file_creator', 'record', 'hrv', 'event', 'lap', 'session', 'activity']);
        const samples = records.filter(record => record.type === 'data' && record.name === 'record');
        expect(samples.map(record => record.fields)).toEqual(appData.records);
        expect(samples.every(record => record.length === 34)).toBe(true);
        const session = records.find(record => record.type === 'data' && record.name === 'session');
        expect(session.fields).toEqual({
            timestamp: 1669140872000, start_time: 1669140869000,
            total_elapsed_time: 3, total_timer_time: 3,
            message_index: 0, sport: 2, sub_sport: 58,
            total_distance: 28.56, total_calories: 0,
            avg_speed: 7.019, max_speed: 7.498,
            avg_heart_rate: 91, max_heart_rate: 93,
            avg_cadence: 71, max_cadence: 73, avg_power: 161, max_power: 163,
            first_lap_index: 0, num_laps: 1, threshold_power: 250,
        });
    });

    test('encodes a complete file with correct sizes and CRCs', () => {
        const encoded = fit.localActivity.encode(appData);
        const header = fit.fileHeader.decode(encoded);
        expect(encoded.byteLength).toBe(476);
        expect(header.dataSize + header.length + fit.CRC.size).toBe(encoded.byteLength);
        expect(fit.CRC.getHeaderCRC(encoded).number)
            .toBe(fit.CRC.calculateCRC(encoded, 0, 11));
        expect(fit.CRC.getFileCRC(encoded).number)
            .toBe(fit.CRC.calculateCRC(encoded, 0, encoded.byteLength - 3));
        expect(fit.CRC.calculateCRC(encoded, 0, encoded.byteLength - 1)).toBe(0);

        const decoded = fit.FITjs.decode(encoded);
        const samples = decoded.filter(record => record.type === 'data' && record.name === 'record');
        expect(samples).toHaveLength(appData.records.length);
        samples.forEach((sample, index) => {
            expect(sample.fields).toMatchObject(appData.records[index]);
        });
        expect(dataviewToArray(fit.FITjs.encode(decoded))).toEqual(dataviewToArray(encoded));
    });
});

describe('Legacy activity fixture', () => {
    test('decodes files generated before file-creator and HRV definitions were added', () => {
        const view = new DataView(Uint8Array.from(flatFitBinary).buffer);
        expect(fit.FITjs.decode(view)).toEqual(FITjs({crc: true}));
    });
});
