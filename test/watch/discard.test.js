/** @jest-environment jsdom */
import { db } from '../../src/db.js';
import { xf } from '../../src/functions.js';
import { models } from '../../src/models/models.js';

test('a discarded stopped ride resets the session without creating or syncing an activity', () => {
    const create = jest.spyOn(models.activity, 'createFromCurrent');
    const discarded = jest.fn();
    window.addEventListener('activity:discarded', discarded, {once: true});
    db.elapsed = 45;
    db.records = [{power: 100}];
    db.laps = [{duration: 45}];
    xf.dispatch('watch:stopped', {discard: true});
    expect(db.elapsed).toBe(0);
    expect(db.records).toEqual([]);
    expect(db.laps).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(discarded).toHaveBeenCalledTimes(1);
    create.mockRestore();
});
