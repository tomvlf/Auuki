import { indoorBikeData } from '../../src/ble/ftms/indoor-bike-data.js';



describe('Indoor Bike Data', () => {

    test('decodes all optional fields in wire order', () => {
        const view = new DataView(new Uint8Array([
            254, 31,       // flags: speed and all optional fields
            202, 12,       // speed
            184, 11,       // average speed
            161, 0,        // cadence
            151, 0,        // average cadence
            86, 52, 18,    // distance
            10, 0,         // resistance
            44, 1,         // power
            250, 0,        // average power
            244, 1,        // total energy
            88, 2,         // energy per hour
            10,            // energy per minute
            143,           // heart rate
            25,            // metabolic equivalent
            16, 14,        // elapsed time
            8, 7,          // remaining time
        ]).buffer);

        expect(indoorBikeData.decode(view)).toEqual({
            speed: 32.74,
            AverageSpeed: 30,
            cadence: 80.5,
            AverageCadence: 75.5,
            distance: 0x123456,
            ResistanceLevel: 10,
            power: 300,
            AveragePower: 250,
            TotalEnergy: 500,
            EnergyPerHour: 600,
            EnergyPerMinute: 10,
            heartRate: 143,
            MetabolicEquivalent: 25,
            ElapsedTime: 3600,
            RemainingTime: 1800,
        });
    });

    test('preserves zero measurements', () => {
        const view = new DataView(new Uint8Array([
            84, 2,
            0, 0,       // speed
            0, 0,       // cadence
            0, 0, 0,    // distance
            0, 0,       // power
            0,          // heart rate
        ]).buffer);

        expect(indoorBikeData.decode(view)).toEqual({
            speed: 0,
            cadence: 0,
            distance: 0,
            power: 0,
            heartRate: 0,
        });
    });

    test('decodes the maximum unsigned 24-bit distance', () => {
        const view = new DataView(new Uint8Array([
            17, 0, 255, 255, 255,
        ]).buffer);

        expect(indoorBikeData.decode(view)).toEqual({ distance: 0xFFFFFF });
    });

    test('respects DataView offset and length within a larger buffer', () => {
        const bytes = new Uint8Array([
            255, 255,
            85, 2, 161, 0, 86, 52, 18, 44, 1, 143,
            255, 255,
        ]);
        const view = new DataView(bytes.buffer, 2, 10);

        expect(indoorBikeData.decode(view)).toEqual({
            cadence: 80.5,
            distance: 0x123456,
            power: 300,
            heartRate: 143,
        });
    });

    describe('truncated packets', () => {
        test.each([
            { name: 'empty flags', bytes: [] },
            { name: 'incomplete flags', bytes: [0] },
            { name: 'missing speed', bytes: [0, 0] },
            { name: 'incomplete speed before heart rate', bytes: [0, 2, 143] },
            { name: 'incomplete distance before power', bytes: [81, 0, 44, 1] },
            { name: 'incomplete power before heart rate', bytes: [65, 2, 143] },
            { name: 'incomplete energy before heart rate', bytes: [1, 3, 244, 1, 143] },
        ])('rejects $name', ({ bytes }) => {
            const view = new DataView(new Uint8Array(bytes).buffer);

            expect(() => indoorBikeData.decode(view)).toThrow(RangeError);
        });

        test('does not read beyond the DataView into the backing buffer', () => {
            const bytes = new Uint8Array([65, 2, 44, 1, 143]);
            const view = new DataView(bytes.buffer, 0, 3);

            expect(() => indoorBikeData.decode(view)).toThrow(RangeError);
        });
    });

    describe('More Data flag', () => {
        test.each([
            {
                name: 'no measurements',
                bytes: [1, 0],
                expected: {},
            },
            {
                name: 'power only',
                bytes: [65, 0, 44, 1],
                expected: { power: 300 },
            },
            {
                name: 'cadence, power and heart rate',
                bytes: [69, 2, 45, 1, 44, 1, 143],
                expected: { cadence: 150.5, power: 300, heartRate: 143 },
            },
        ])('omits speed and decodes $name', ({ bytes, expected }) => {
            const view = new DataView(new Uint8Array(bytes).buffer);

            expect(indoorBikeData.decode(view)).toEqual(expected);
        });
    });

    test('speed-cadence-power', () => {
        const view = new DataView(
            new Uint8Array([
                 68,  0, // flags, 0b1000100
                202, 12, // instantaneous speed
                160,  0, // instantaneous cadence
                 44,  1, // power
            ]).buffer
        );

        const expected = {
            speed: 32.74,
            cadence: 80,
            power: 300,
        };

        const res = indoorBikeData.decode(view);
        expect(res).toEqual(expected);
    });

    test('speed-cadence-power-heartRate', () => {
        const view = new DataView(
            new Uint8Array([
                 68,  2, // flags, 0b1001000100
                202, 12, // instantaneous speed
                160,  0, // instantaneous cadence
                 44,  1, // power
                143,     // heart rate
            ]).buffer
        );

        const expected = {
            speed: 32.74,
            cadence: 80,
            power: 300,
            heartRate: 143,
        };

        const res = indoorBikeData.decode(view);
        expect(res).toEqual(expected);
    });

    test('speed-cadence-distance-power-heartRate', () => {
        // ['0x54', '0x02', '0xCA', '0x0C', '0xA0', '0x00', '0xD3', '0xA4', '0x00', '0x2C', '0x01', '0x8F']
        // '0x 54 02 CA 0C A0 00 D3 A4 00 2C 01 8F'

        const view = new DataView(
            new Uint8Array([
                84, 2,       // flags, 0b1001010100
                202, 12,     // instantaneous speed
                160, 0,      // instantaneous cadence
                211, 164, 0, // total distance
                44, 1,       // power
                143,         // heart rate
            ]).buffer
        );

        const expected = {
            speed:   32.74,
            cadence: 80,
            distance: 42195,
            power:   300,
            heartRate: 143,
        };

        const res = indoorBikeData.decode(view);

        expect(res).toEqual(expected);
    });
});
