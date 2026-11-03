import { FileId, Event, Lap, Session, Activity } from '../../src/fit/local-activity.js';
import { EventType } from '../../src/activity/enums.js';

describe('Local activity messages', () => {
    const timestamp = 1630508409000;
    const start_time = 1630508400000;

    test('FileId uses application timestamps and default identifiers', () => {
        expect(FileId({time_created: start_time})).toEqual({
            time_created: start_time, manufacturer: 255, product: 0,
            serial_number: 0, number: 0, type: 4,
        });
    });

    test('Event maps the application event type to the FIT enum', () => {
        expect(Event({timestamp, type: EventType.stop})).toEqual({
            timestamp, event: 0, event_type: 1, event_group: 0,
        });
    });

    test('Lap preserves elapsed and timer times separately', () => {
        expect(Lap({
            timestamp, start_time, total_elapsed_time: 9, total_timer_time: 6,
            message_index: 1,
        })).toEqual({
            timestamp, start_time, total_elapsed_time: 9, total_timer_time: 6,
            message_index: 1, event: 9, event_type: 1,
        });
    });

    test('Session includes cycling classification, lap count and training threshold', () => {
        expect(Session({
            timestamp, start_time, total_elapsed_time: 9, total_timer_time: 6,
            laps: [{}, {}], stats: {avg_power: 180, max_power: 193}, threshold_power: 250,
        })).toEqual({
            timestamp, start_time, total_elapsed_time: 9, total_timer_time: 6,
            message_index: 0, first_lap_index: 0, num_laps: 2, sport: 2, sub_sport: 58,
            avg_power: 180, max_power: 193, threshold_power: 250,
        });
    });

    test('Activity includes the actual recorded timer duration', () => {
        expect(Activity({timestamp, total_timer_time: 6})).toEqual({
            timestamp, total_timer_time: 6, num_sessions: 1, type: 0,
            event: 26, event_type: 1,
        });
    });

    test.each([
        ['Event', Event], ['Lap', Lap], ['Session', Session], ['Activity', Activity],
    ])('%s rejects missing required values', (_, create) => {
        expect(() => create()).toThrow();
    });
});
