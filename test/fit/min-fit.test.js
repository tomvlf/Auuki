/*
 * min-fit.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * documents the expected behavior of the application and prevents regressions during development.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { dataviewToArray } from '../../src/functions.js';
import { fit } from '../../src/fit/fit.js';
import { data } from './min-data.js';

function view(bytes) {
    return new DataView(Uint8Array.from(bytes).buffer);
}

describe('FIT file headers', () => {
    test.each([
        [[14, 32, 92, 8, 39, 0, 0, 0, 46, 70, 73, 84, 123, 197], {
            type: 'header', length: 14, headerSize: 14, protocolVersion: '2.0',
            profileVersion: '21.40', dataSize: 39, dataType: '.FIT', crc: 50555,
        }],
        [[12, 16, 100, 0, 241, 118, 2, 0, 46, 70, 73, 84], {
            type: 'header', length: 12, headerSize: 12, protocolVersion: '1.0',
            profileVersion: '1.00', dataSize: 161521, dataType: '.FIT',
        }],
        [[12, 16, 100, 0, 0, 0, 0, 0, 46, 70, 73, 84], {
            type: 'header', length: 12, headerSize: 12, protocolVersion: '1.0',
            profileVersion: '1.00', dataSize: 0, dataType: '.FIT',
        }],
    ])('decodes header %j', (bytes, expected) => {
        expect(fit.fileHeader.decode(view(bytes))).toEqual(expected);
    });

    test('encodes a standard header with the correct CRC', () => {
        const header = fit.fileHeader.toFITjs({dataSize: 100});
        const encoded = fit.fileHeader.encode(header, new DataView(new ArrayBuffer(14)));
        expect(dataviewToArray(encoded)).toEqual([
            14, 32, 92, 8, 100, 0, 0, 0, 46, 70, 73, 84, 63, 224,
        ]);
    });

    test('encodes a legacy header without a CRC', () => {
        const header = fit.fileHeader.toFITjs({
            headerSize: 12, protocolVersion: '1.0', profileVersion: '1.00',
            dataSize: 434544,
        });
        const encoded = fit.fileHeader.encode(header, new DataView(new ArrayBuffer(12)));
        expect(dataviewToArray(encoded)).toEqual([
            12, 16, 100, 0, 112, 161, 6, 0, 46, 70, 73, 84,
        ]);
    });
});

describe('FIT record headers', () => {
    test.each([
        [64, 'definition', 0],
        [65, 'definition', 1],
        [68, 'definition', 4],
        [0, 'data', 0],
        [2, 'data', 2],
        [4, 'data', 4],
    ])('decodes and encodes header %i', (byte, messageType, localMessageType) => {
        const decoded = fit.recordHeader.decode(byte);
        expect(decoded).toEqual({
            headerType: 'normal', messageType, messageTypeSpecific: 'reserved',
            localMessageType,
        });
        expect(fit.recordHeader.encode(decoded)).toBe(byte);
        expect(fit.recordHeader.isDefinition(byte)).toBe(messageType === 'definition');
        expect(fit.recordHeader.isData(byte)).toBe(messageType === 'data');
    });

    test('recognizes developer definitions in numeric and decoded headers', () => {
        const decoded = fit.recordHeader.decode(0x60);
        expect(fit.recordHeader.isDeveloper(0x60)).toBe(true);
        expect(fit.recordHeader.isDeveloper(decoded)).toBe(true);
        expect(fit.recordHeader.isDeveloper(0x40)).toBe(false);
    });
});

describe('FIT definition and data records', () => {
    const records = fit.FITjs.decode(view(data.minimal));
    const definitions = records.filter(record => record.type === 'definition');

    test.each(definitions.map(definition => [definition.name, definition]))(
        'round-trips the %s definition without writing an empty developer section',
        (_, definition) => {
            const encoded = fit.definitionRecord.encode(
                definition, new DataView(new ArrayBuffer(definition.length)),
            );
            expect(fit.definitionRecord.decode(encoded)).toEqual(definition);
            expect(encoded.getUint8(0) & 0x20).toBe(0);
        },
    );

    test.each(definitions.map(definition => [definition.name, definition]))(
        'round-trips %s data using its definition',
        (name, definition) => {
            for(const record of records.filter(record =>
                record.type === 'data' && record.name === name)) {
                const encoded = fit.dataRecord.encode(
                    definition, record, new DataView(new ArrayBuffer(record.length)),
                );
                expect(fit.dataRecord.decode(definition, encoded)).toEqual(record);
            }
        },
    );

    test('decodes the file ID definition from independently specified bytes', () => {
        const definition = fit.definitionRecord.decode(view([
            64, 0, 0, 0, 0, 5, 4, 4, 134, 1, 2, 132, 2, 2, 132,
            5, 2, 132, 0, 1, 0,
        ]));
        expect(definition).toEqual({
            type: 'definition', name: 'file_id', architecture: 0, local_number: 0,
            length: 21, data_record_length: 12, dev_fields: [],
            fields: [
                {number: 4, size: 4, base_type: 'uint32'},
                {number: 1, size: 2, base_type: 'uint16'},
                {number: 2, size: 2, base_type: 'uint16'},
                {number: 5, size: 2, base_type: 'uint16'},
                {number: 0, size: 1, base_type: 'enum'},
            ],
        });
    });
});
